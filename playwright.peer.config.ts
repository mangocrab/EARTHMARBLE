import { defineConfig } from "@playwright/test";
import common from "./playwright.config";
export default defineConfig({
  ...common,
  testDir: "tests/peer",
  outputDir: "test-results-peer",
  timeout: 60000,
  use: { ...common.use, baseURL: "http://127.0.0.1:3207" },
  webServer: [
    {
      command: "node tests/fixtures/peer-server.mjs",
      url: "http://127.0.0.1:3206/peerjs/id",
      reuseExistingServer: false,
    },
    {
      command: "npx vite --mode solo --host 127.0.0.1 --port 3207 --strictPort",
      url: "http://127.0.0.1:3207",
      env: {
        VITE_SIGNAL_URL: "http://127.0.0.1:3206/",
        VITE_TURN_URL: "turn:127.0.0.1:3208?transport=tcp",
      },
      reuseExistingServer: false,
    },
  ],
});
