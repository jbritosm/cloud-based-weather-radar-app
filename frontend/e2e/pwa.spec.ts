import { expect, test } from "@playwright/test";
import { mockExternal } from "./mocks";

test.beforeEach(async ({ context }) => {
  await mockExternal(context);
});

/** Width and height stored in a PNG's header. */
function pngSize(bytes: Buffer): [number, number] {
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test("the manifest is valid and every icon exists with the size it declares", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);

  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");
  expect(manifest.name).toBeTruthy();
  const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose);
  expect(purposes).toContain("any");
  expect(purposes).toContain("maskable"); // Android adaptive icons

  for (const icon of manifest.icons as { src: string; sizes: string; type: string }[]) {
    const response = await request.get(icon.src);
    expect(response.status(), icon.src).toBe(200);
    expect(response.headers()["content-type"]).toContain(icon.type);
    const [w, h] = icon.sizes.split("x").map(Number);
    expect(pngSize(await response.body()), icon.src).toEqual([w, h]);
  }
  // Chrome needs a 192 and a 512 icon to offer installation
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");
});

test("the service worker installs and the app shell opens without a connection", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();

  // the worker takes control and has cached the shell during installation
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith("tfg-shell-"))))
    .toBe(true);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Plataforma de radar meteorológico");
  await expect(page.getByRole("button", { name: /Capas|Cambiar idioma/ }).first()).toBeAttached();
  await context.setOffline(false);
});

test("live data and other origins are never served from the worker's cache", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys()) {
      for (const request of await (await caches.open(key)).keys()) urls.push(request.url);
    }
    return urls;
  });
  expect(cached.length).toBeGreaterThan(0);
  expect(cached.some((u) => u.includes("/api/"))).toBe(false);
  expect(cached.every((u) => u.startsWith("http://localhost:4173/"))).toBe(true);
});

test("the service worker file is served fresh, not from a long-lived cache", async ({ request }) => {
  const response = await request.get("/sw.js");
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("addEventListener(\"fetch\"");
});
