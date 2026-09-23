import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry"
  },
  webServer: [
    {
      command: "pnpm --filter @todoist-clonse/backend dev",
      url: "http://127.0.0.1:3000/tasks",
      reuseExistingServer: true
    },
    {
      command: "pnpm --filter @todoist-clonse/frontend dev --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true
    }
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
