import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "/tmp/ledashboard-playwright-results",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{projectName}/{platform}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
    locale: "fr-FR",
    reducedMotion: "reduce",
    timezoneId: "Europe/Paris",
  },
  projects: [{
    name: "system-chrome",
    use: { channel: "chrome" },
  }],
  webServer: {
    command: "npm --workspace @ledashboard/web run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/ledashboard/",
    reuseExistingServer: !process.env.CI,
  },
});
