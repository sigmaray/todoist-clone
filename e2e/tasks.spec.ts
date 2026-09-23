import { expect, test } from "@playwright/test";

const createTask = (page: Parameters<Parameters<typeof test>[1]>[0]) => async (title: string) => {
  await page.getByLabel("Task title").fill(title);
  await page.getByRole("button", { name: "Add task" }).click();
};

test("creates a task in the browser", async ({ page }) => {
  await page.goto("/");

  await createTask(page)("Write the first MVP task");

  await expect(page.getByText("Write the first MVP task")).toBeVisible();

  await page.getByRole("button", { name: "Edit task Write the first MVP task" }).click();
  await page.getByLabel("Edit Write the first MVP task").fill("Write the first persistent MVP task");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Write the first persistent MVP task")).toBeVisible();

  await page.getByRole("button", { name: "Delete task Write the first persistent MVP task" }).click();

  await expect(page.getByText("Write the first persistent MVP task")).not.toBeVisible();
});
