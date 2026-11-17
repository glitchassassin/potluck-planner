import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:44101", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node --import remix/node-tsx ../dev/start.ts --production-build",
    cwd: "./dist",
    env: { PORT: "44101", NODE_ENV: "production" },
    url: "http://127.0.0.1:44101/sign-in",
    reuseExistingServer: false,
  },
});
