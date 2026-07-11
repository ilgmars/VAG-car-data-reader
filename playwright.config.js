const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:8199",
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: "python3 -m http.server 8199 --bind 127.0.0.1",
    url: "http://127.0.0.1:8199",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "tablet",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 834, height: 1112 },
        hasTouch: true,
      },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
