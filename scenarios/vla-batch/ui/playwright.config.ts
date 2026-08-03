import { defineConfig, devices } from "@playwright/test";

/**
 * De UI wordt getest tegen een ECHT draaiende engine, niet tegen mocks. Een
 * mock kan de twee weigeringsvormen en de drie scan-gate-toestanden namelijk
 * niet reproduceren, en dat zijn juist de dingen die stil kapot gaan.
 *
 * Zet ENGINE_URL naar een draaiende batch-engine voordat je dit draait.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: {
    // Live data beweegt: tellers, tijden, sparklines. De drempel laat die
    // ruis door zonder een echte layout- of kleurwijziging te missen.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled" },
  },
  use: {
    baseURL: process.env.UI_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    // Vast venster: anders verschilt elke snapshot per machine.
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
