import { defineConfig, devices } from "@playwright/test";

// The map needs WebGL; headless Chromium provides it through SwiftShader (software rendering).
const webgl = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"];

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    trace: "retain-on-failure",
    launchOptions: { args: webgl },
    serviceWorkers: "block", // only the PWA project lets the service worker run
  },
  projects: [
    { name: "desktop", testMatch: /(app|a11y|security)\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 5"] } },
    { name: "pwa", testMatch: /pwa\.spec\.ts/, use: { ...devices["Desktop Chrome"], serviceWorkers: "allow" } },
  ],
  // The tests run against the production build, exactly what nginx serves
  webServer: {
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
