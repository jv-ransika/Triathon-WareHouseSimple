import { defineConfig } from "@playwright/test";

// Local: runs against `next start` on port 3100 (built app + dev.db).
// Remote: BASE_URL=https://triathon-warehouse-simple.vercel.app npm run test:e2e
const baseURL = process.env.BASE_URL || "http://localhost:3100";
const remote = !!process.env.BASE_URL;

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  timeout: remote ? 180_000 : 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    channel: "chrome", // use the installed Chrome; no browser download needed
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: remote
    ? undefined
    : { command: "npx next start -p 3100", url: "http://localhost:3100/login", reuseExistingServer: true, timeout: 120_000 },
});
