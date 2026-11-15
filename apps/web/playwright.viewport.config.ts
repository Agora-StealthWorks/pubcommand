import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  webServer: {
    command: "pnpm exec next start -H 127.0.0.1 -p 4173",
    url: "http://127.0.0.1:4173/login",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      VIEWPORT_CHECK: "1",
      ROOT_DOMAIN: "localhost",
      DATABASE_URL: process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand",
      AUTH_SECRET: process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16 ? process.env.AUTH_SECRET : "viewport-check-secret-value",
    },
  },
});
