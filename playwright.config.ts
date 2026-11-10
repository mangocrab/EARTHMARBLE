import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3198",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: [
        "--no-sandbox",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run start",
      url: "http://127.0.0.1:3198/api/health",
      env: { PORT: "3198", DATA_DIR: ".data/e2e" },
      reuseExistingServer: false,
    },
    {
      command: "npm run start",
      url: "http://127.0.0.1:3199/api/health",
      env: {
        PORT: "3199",
        DATA_DIR: ".data/e2e-external",
        IDENTITY_ADAPTER_MODULE: "tests/fixtures/site-adapter.ts",
        SITE_TEST_SIGNING_KEY: "earth-tests-only",
      },
      reuseExistingServer: false,
    },
  ],
});
