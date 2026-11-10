import { defineConfig } from "@playwright/test";
import common from "./playwright.config";
const basePath =
  (process.env.PAGES_BASE_PATH || "/EARTHMARBLE/").replace(/\/+$/, "") + "/";
export default defineConfig({
  ...common,
  testDir: "tests/pages",
  outputDir: "test-results-pages",
  use: { ...common.use, baseURL: "http://127.0.0.1:3204" + basePath },
  webServer: {
    command:
      "npx vite preview --mode pages --host 127.0.0.1 --port 3204 --strictPort",
    url: "http://127.0.0.1:3204" + basePath,
    reuseExistingServer: false,
  },
});
