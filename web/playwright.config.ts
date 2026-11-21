import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// The specs sign in with SEED_OWNER_* and sign webhooks with META_APP_SECRET from the repo-root .env.
try { process.loadEnvFile(join(__dirname, "..", ".env")); } catch { /* CI can pass the variables directly */ }

// Smoke tests run against the local dev server with seeded fixture data (npm run db:seed).
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  workers: 2,
  outputDir: "../test-results",
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100", channel: "chrome", headless: true, screenshot: "only-on-failure" },
  webServer: { command: "npm run dev", url: "http://localhost:3100/login", reuseExistingServer: true, timeout: 120_000 },
});
