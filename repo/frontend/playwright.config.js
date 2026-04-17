import { defineConfig } from "@playwright/test";

// E2E against the REAL backend. Prereqs:
//   docker-compose up --build   (backend at :3000, mysql seeded)
// The Vite dev server is started by this config on :4173 with the
// backend URL pointing at the real API.
const backendUrl = process.env.VITE_API_BASE_URL || "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:4173",
    headless: true,
    trace: "retain-on-failure"
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx cross-env VITE_API_BASE_URL=${backendUrl} npm run dev -- --host 127.0.0.1 --port 4173`,
        port: 4173,
        reuseExistingServer: true,
        timeout: 120_000
      }
});
