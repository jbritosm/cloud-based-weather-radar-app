import { expect, test, type Page } from "@playwright/test";
import { mockExternal } from "./mocks";

test.beforeEach(async ({ context }) => {
  await mockExternal(context);
});

async function open(page: Page, query = "") {
  await page.goto(`/${query}`);
  await expect(page.locator(".timebar-label strong")).toBeVisible();
}

test("the panel is a drawer that opens from the Layers button and closes again", async ({ page }) => {
  await open(page);
  const panel = page.locator(".panel");
  await expect(panel).not.toHaveClass(/open/);
  await page.getByRole("button", { name: /Capas/ }).tap();
  await expect(panel).toHaveClass(/open/);
  await page.getByRole("button", { name: "Cerrar panel" }).tap();
  await expect(panel).not.toHaveClass(/open/);
});

test("choosing a quick view closes the drawer", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /Capas/ }).tap();
  await page.getByRole("button", { name: "Tormentas" }).tap();
  await expect(page.locator(".panel")).not.toHaveClass(/open/);
  await expect.poll(() => page.url()).toContain("layers=msg-ir108,rain-radar");
});

test("the legend starts collapsed to leave room for the map", async ({ page }) => {
  await open(page);
  await expect(page.locator("details.legend")).not.toHaveAttribute("open", "");
});

test("the controls do not cover the map attribution, and nothing scrolls sideways", async ({ page }) => {
  await open(page);
  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    return {
      timebarBottom: rect(".timebar").bottom,
      attributionTop: rect(".maplibregl-ctrl-attrib").top,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
  expect(geometry.timebarBottom).toBeLessThanOrEqual(geometry.attributionTop + 1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth);
});

test("dark mode works in the drawer too", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  await page.getByRole("button", { name: /Capas/ }).tap();
  await page.getByRole("button", { name: "Cambiar a modo oscuro" }).tap();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.locator(".panel").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(16, 22, 29)");
});
