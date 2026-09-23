import { expect, test } from "@playwright/test";

test("runs a SQL query from the development tools page", async ({ page }) => {
  await page.goto("/tools/");

  await expect(page.getByRole("heading", { name: "Database Tools" })).toBeVisible();
  await page.getByLabel("PostgreSQL query").fill("SELECT 1 AS value;");
  await page.getByRole("button", { name: "Run query" }).click();

  await expect(page.getByText('"value": 1')).toBeVisible();
});
