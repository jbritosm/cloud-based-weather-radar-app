import { expect, test } from "@playwright/test";
import { mockExternal } from "./mocks";

test.beforeEach(async ({ context }) => {
  await mockExternal(context);
});

test("the production page carries a content security policy", async ({ page }) => {
  await page.goto("/");
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).not.toContain("unsafe-eval");
});

test("there is no inline script for an attacker to imitate", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  expect(await page.locator("script:not([src])").count()).toBe(0);
});

test("a whole session (every layer, animation, dark mode, language, dragging) breaks no policy rule", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __violations: string[] }).__violations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __violations: string[] }).__violations.push(
        `${event.violatedDirective} blocked ${event.blockedURI}`,
      );
    });
  });
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/.test(message.text())) consoleMessages.push(message.text());
  });

  await page.goto("/");
  await expect(page.locator(".timebar-label strong")).toBeVisible();

  // switch on every layer, so every tile server and legend image is requested
  for (const box of await page.locator(".layer input[type=checkbox]").all()) {
    if (!(await box.isChecked())) await box.check();
  }
  await page.getByRole("button", { name: "Reproducir animación" }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Pausar animación" }).click();
  await page.getByText("Estado del sistema").click();
  await page.getByRole("button", { name: "Cambiar a modo oscuro" }).click();
  await page.getByRole("button", { name: "Cambiar idioma" }).click();
  await page.mouse.move(800, 300);
  await page.mouse.down();
  await page.mouse.move(650, 400, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(1500);

  const violations = await page.evaluate(() => (window as unknown as { __violations: string[] }).__violations);
  expect(violations).toEqual([]);
  expect(consoleMessages).toEqual([]);
});

test("nothing outside the allowed hosts is contacted", async ({ page }) => {
  const contacted = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http")) contacted.add(url.origin);
  });
  await page.goto("/");
  await expect(page.locator(".timebar-label strong")).toBeVisible();
  await page.getByLabel(/Infrarrojo 10,8/).check();
  await page.getByLabel(/Lluvia estimada/).check();
  await page.waitForTimeout(1500);

  expect([...contacted].sort()).toEqual(
    [
      "http://localhost:4173",
      "https://api.rainviewer.com",
      "https://tile.openstreetmap.org",
      "https://tilecache.rainviewer.com",
      "https://view.eumetsat.int",
    ].sort(),
  );
});
