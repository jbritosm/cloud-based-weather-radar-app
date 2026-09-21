import { expect, test, type Page } from "@playwright/test";
import { NEWEST, iso, mockExternal, timesFor, type Recorded } from "./mocks";

const MIN = 60_000;

let recorded: Recorded;

test.beforeEach(async ({ context }) => {
  recorded = await mockExternal(context);
});

/** Opens the app and waits until the time bar knows the available images. */
async function open(page: Page, query = "") {
  await page.goto(`/${query}`);
  await expect(page.locator(".timebar-label strong")).toBeVisible();
}

const label = (page: Page) => page.locator(".timebar-label");

test("starts on the latest image with the default layers", async ({ page }) => {
  await open(page);
  await expect(label(page)).toContainText("última");
  expect(page.url()).toContain("layers=mtg-geocolour,rain-radar");
  await expect(page.getByLabel(/Geo Colour/)).toBeChecked();
  await expect(page.getByLabel(/Radar de lluvia/)).toBeChecked();
  await expect(page.getByLabel(/Infrarrojo 10,8/)).not.toBeChecked();
});

test("asks each layer for its own closest image when stepping back in time", async ({ page }) => {
  await open(page);
  await page.getByLabel(/Infrarrojo 10,8/).check(); // MSG: one image every 15 min

  // Latest: every layer shows its newest image (radar frame f0 is the newest)
  await expect.poll(() => timesFor(recorded, "mtg_fd:rgb_geocolour")).toContain(iso(NEWEST));
  await expect.poll(() => timesFor(recorded, "msg_fes:ir108")).toContain(iso(NEWEST));
  await expect.poll(() => recorded.radar.some((u) => u.includes("/v2/radar/f0/"))).toBe(true);

  await page.getByRole("button", { name: "Imagen anterior" }).click(); // 15 minutes back

  // MTG makes an image every 10 min: the newest one at or before -15 min is -20 min
  await expect.poll(() => timesFor(recorded, "mtg_fd:rgb_geocolour")).toContain(iso(NEWEST - 20 * MIN));
  // MSG makes one every 15 min: exactly -15 min
  await expect.poll(() => timesFor(recorded, "msg_fes:ir108")).toContain(iso(NEWEST - 15 * MIN));
  // Radar frames are 10 min apart: the newest at or before -15 min is f2 (-20 min)
  await expect.poll(() => recorded.radar.some((u) => u.includes("/v2/radar/f2/"))).toBe(true);
});

test("never asks for a time in the future", async ({ page }) => {
  await open(page);
  await page.getByLabel(/Infrarrojo 10,5/).check();
  await expect.poll(() => timesFor(recorded, "mtg_fd:ir105_hrfi").length).toBeGreaterThan(0);
  for (const layer of ["mtg_fd:rgb_geocolour", "mtg_fd:ir105_hrfi"]) {
    for (const time of timesFor(recorded, layer)) {
      if (time !== "none") expect(Date.parse(time)).toBeLessThanOrEqual(NEWEST);
    }
  }
});

test("play advances the animation, pause stops it, and Now returns to the latest", async ({ page }) => {
  await open(page);
  const start = await label(page).innerText();

  await page.getByRole("button", { name: "Reproducir animación" }).click();
  await expect.poll(async () => label(page).innerText(), { timeout: 8000 }).not.toBe(start);

  await page.getByRole("button", { name: "Pausar animación" }).click();
  const paused = await label(page).innerText();
  await page.waitForTimeout(2200);
  expect(await label(page).innerText()).toBe(paused);

  await page.getByRole("button", { name: "Ahora" }).click();
  await expect(label(page)).toContainText("última");
});

test("stepping with the arrows and the slider leaves the latest image", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Imagen anterior" }).click();
  await expect(label(page)).not.toContainText("última");
  await page.getByRole("button", { name: "Imagen siguiente" }).click();
  await expect(label(page)).toContainText("última");
  await page.getByRole("slider", { name: "Hora" }).fill("0");
  await expect(label(page)).not.toContainText("última");
});

test("layers can be toggled and the shareable link follows", async ({ page }) => {
  await open(page);
  await page.getByLabel(/Radar de lluvia/).uncheck();
  await expect.poll(() => page.url()).not.toContain("rain-radar");
  expect(page.url()).toContain("layers=mtg-geocolour");
  await page.getByLabel(/Lluvia estimada/).check();
  await expect.poll(() => page.url()).toContain("msg-precip");
});

test("quick views set several layers at once", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Tormentas" }).click();
  await expect.poll(() => page.url()).toContain("layers=msg-ir108,rain-radar");
  await expect(page.getByLabel(/Geo Colour/)).not.toBeChecked();
  await page.getByRole("button", { name: "Nubes" }).click();
  await expect.poll(() => page.url()).toContain("layers=mtg-geocolour&");
});

test("legends appear for the layers that are on", async ({ page }) => {
  await open(page);
  await expect(page.locator(".legend .gradient")).toBeVisible(); // radar scale, on by default
  await page.getByLabel(/Lluvia estimada/).check();
  const image = page.locator(".legend img").first();
  await expect(image).toBeVisible();
  // visible does not mean decoded yet: wait until the browser has the picture
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await page.getByLabel(/Radar de lluvia/).uncheck();
  await expect(page.locator(".legend .gradient")).toHaveCount(0);
});

test("dragging the map updates the shareable link", async ({ page }) => {
  await open(page);
  const before = page.url();
  await page.mouse.move(800, 300);
  await page.mouse.down();
  await page.mouse.move(600, 420, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.url()).not.toBe(before);
});

test("a shared link restores view, layers and language; bad values are ignored", async ({ page }) => {
  await open(page, "?lat=43.36&lng=-5.85&z=7&layers=msg-ir108&lang=en");
  await expect(page.locator("h1")).toHaveText("Weather Radar Platform");
  await expect(page.getByLabel(/Infrared 10.8/)).toBeChecked();
  await expect(page.getByLabel(/Geo Colour/)).not.toBeChecked();
  expect(page.url()).toContain("lat=43.360");
  expect(page.url()).toContain("z=7.00");

  // Nothing saved and garbage in the link: defaults (Spanish), the valid part of the layers kept.
  // (English was saved by the visit above, so forget it first.)
  await page.evaluate(() => localStorage.clear());
  await page.goto("/?lat=abc&z=999&layers=nope,rain-radar&lang=xx");
  await expect(page.locator("h1")).toHaveText("Plataforma de radar meteorológico");
  await expect(page.getByLabel(/Radar de lluvia/)).toBeChecked();
  await expect(page.getByLabel(/Geo Colour/)).not.toBeChecked();
});

test("Zoom to Spain moves the map", async ({ page }) => {
  await open(page, "?lat=10&lng=10&z=3&layers=mtg-geocolour");
  await page.getByRole("button", { name: "Ir a España" }).click();
  await expect.poll(() => page.url()).toMatch(/lat=(3[5-9]|4[0-4])\./);
});

test("the language switch works and is remembered", async ({ page }) => {
  await open(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await page.getByRole("button", { name: "Cambiar idioma" }).click();
  await expect(page.locator("h1")).toHaveText("Weather Radar Platform");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/"); // no ?lang: the saved choice applies
  await expect(page.locator("h1")).toHaveText("Weather Radar Platform");
});

test.describe("dark mode", () => {
  const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  test("follows the system preference until the visitor chooses", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await background(page)).toBe("rgb(16, 22, 29)");

    await page.getByRole("button", { name: "Cambiar a modo claro" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await background(page)).toBe("rgb(255, 255, 255)");

    // the explicit choice beats the system preference, also after a reload
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("the switch toggles and the choice is remembered", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await open(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Cambiar a modo oscuro" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#10161d");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("the legend images stay readable on a dark background", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page);
    await page.getByLabel(/Lluvia estimada/).check();
    const image = page.locator(".legend img").first();
    await expect(image).toBeVisible();
    expect(await image.evaluate((img) => getComputedStyle(img).backgroundColor)).toBe("rgb(255, 255, 255)");
  });
});

test("a layer that fails to load shows a notice instead of failing silently", async ({ page, context }) => {
  await context.route(/layers=msg_fes:ir108/, (route) => route.fulfill({ status: 500, body: "boom" }));
  await open(page);
  await page.getByLabel(/Infrarrojo 10,8/).check();
  await expect(page.getByRole("alert")).toContainText("No se pudieron cargar algunas capas");
});

test("the system status panel lists the sources and the ingested products", async ({ page }) => {
  await open(page);
  await page.getByText("Estado del sistema").click();
  await expect(page.getByText("noaa_nexrad").first()).toBeVisible();
  await expect(page.getByText("requiere configuración")).toBeVisible(); // aemet_radar: no key
  await expect(page.getByText("prevista")).toBeVisible(); // eumetsat: planned
});
