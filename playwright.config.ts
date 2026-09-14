import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: process.env.EXPO_PUBLIC_API_BASE_URL || "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npx tsx server/_core/index.ts",
    url: "http://127.0.0.1:3000/api/ready",
    reuseExistingServer: true,
    timeout: 30000,
  },
});
