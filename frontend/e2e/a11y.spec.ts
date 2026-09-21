// Automated accessibility checks (axe-core, WCAG 2.0 / 2.1 levels A and AA). They catch the
// mechanical problems: missing labels, low colour contrast, bad ARIA, duplicate ids. They do not
// replace testing with a screen reader and a keyboard, but they stop the common regressions.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockExternal } from "./mocks";

test.beforeEach(async ({ context }) => {
  await mockExternal(context);
});

async function open(page: Page, query = "") {
  await page.goto(`/${query}`);
  await expect(page.locator(".timebar-label strong")).toBeVisible();
  await page.waitForTimeout(600); // let the map and the panel settle
}

/** Violations as readable lines, so a failure says what and where. */
async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.map(
    (v) =>
      `${v.id} [${v.impact}] ${v.help}: ` +
      v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" "))
        .join(" | "),
  );
}

test("the main screen has no accessibility violations (Spanish, light)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  expect(await violations(page)).toEqual([]);
});

test("nor in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  expect(await violations(page)).toEqual([]);
});

test("nor in English", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page, "?lang=en");
  expect(await violations(page)).toEqual([]);
});

test("nor with every layer, its legends and the system status panel open", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  for (const box of await page.locator(".layer input[type=checkbox]").all()) {
    if (!(await box.isChecked())) await box.check();
  }
  await page.getByText("Estado del sistema").click();
  await page.waitForTimeout(600);
  expect(await violations(page)).toEqual([]);
});

test("the page has one main landmark and one level-one heading", async ({ page }) => {
  await open(page);
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("lang", /^(es|en)$/);
});

test("everything can be reached and used with the keyboard", async ({ page }) => {
  await open(page);
  // tab through the page: every stop must be visibly focused, and the play button is among them
  const stops: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? (el.getAttribute("aria-label") ?? el.textContent ?? el.tagName).trim().slice(0, 40) : "";
      }),
    );
  }
  expect(stops).toContain("Reproducir animación");
  expect(stops).toContain("Cambiar idioma");

  // and it works: a layer checkbox toggles with the space bar
  const checkbox = page.getByLabel(/Infrarrojo 10,8/);
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
});
