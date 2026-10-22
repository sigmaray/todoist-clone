import { expect, test } from "@playwright/test";

const unique = (label: string) => `${label} ${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;

test("edits task details and copies all Markdown", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  const title = unique("Detailed task");
  await page.getByLabel("Task title for Inbox").fill(title);
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByRole("button", { name: title, exact: true }).click();
  await page.getByLabel("Description").fill("Task details saved from the dialog");
  await page.getByLabel("Date", { exact: true }).fill("2026-11-01");
  await page.getByLabel("Labels").fill("work, review");
  await page.getByLabel("Add comment").fill("First comment");
  await page.getByRole("button", { name: "Add comment" }).click();
  await page.getByLabel("New subtask title").fill("Nested from details");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Save task" }).click();

  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByLabel("Description")).toHaveValue("Task details saved from the dialog");
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2026-11-01");
  await expect(page.getByLabel("Labels")).toHaveValue("work, review");
  await expect(page.getByText("First comment")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Nested from details", exact: true })).toBeVisible();
  const comment = page.locator(".task-comment");
  await comment.getByRole("button", { name: "Edit", exact: true }).click();
  await comment.locator("textarea").fill("Edited comment");
  await comment.getByRole("button", { name: "Save comment" }).click();
  await expect(comment).toContainText("Edited comment");
  await comment.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(comment).not.toBeVisible();
  await page.getByRole("button", { name: "Close task details" }).click();

  await page.getByRole("button", { name: "Copy all markdown" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(title);
});

test("archives and restores projects, and views table records", async ({ page }) => {
  await page.goto("/");
  const title = unique("Archive candidate");
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: title, exact: true }).click();
  const taskTitle = unique("Archived task");
  await page.getByLabel(new RegExp(`Task title for ${title}`)).fill(taskTitle);
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByRole("button", { name: `Add subtask to ${taskTitle}` }).click();
  const subtaskTitle = unique("Nested archived task");
  await page.getByLabel(`Subtask for ${taskTitle}`).fill(subtaskTitle);
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await page.locator(`summary[aria-label="Project menu ${title}"]`).click();
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  const copyTitle = `${title} copy`;
  await expect(page.getByRole("button", { name: copyTitle, exact: true })).toBeVisible();
  await expect(page.locator(".project-menu[open]")).toHaveCount(0);
  await page.getByRole("button", { name: copyTitle, exact: true }).click();
  const copiedProjectTasks = page.getByLabel(`${copyTitle} tasks`);
  await expect(copiedProjectTasks).toContainText(taskTitle);
  await expect(copiedProjectTasks).toContainText(subtaskTitle);
  await page.locator(`summary[aria-label="Project menu ${copyTitle}"]`).click();
  await page.locator(".project-nav-row").filter({ hasText: copyTitle }).getByRole("button", { name: "Archive", exact: true }).click();

  await page.getByRole("link", { name: "Archived projects" }).click();
  const archivedProject = page.locator(".archived-project").filter({ hasText: copyTitle });
  await expect(archivedProject).toBeVisible();
  await archivedProject.getByRole("button", { name: "View tasks" }).click();
  await expect(page.getByRole("region", { name: `${copyTitle} tasks` })).toContainText(taskTitle);
  await archivedProject.getByRole("button", { name: "Restore" }).click();
  await expect(archivedProject).not.toBeVisible();

  await page.goto("/tools/");
  await page.getByLabel("Table", { exact: true }).selectOption("tasks");
  await page.getByLabel("Rows to view").selectOption("100");
  await page.getByRole("button", { name: "View records" }).click();
  await expect(page.locator(".query-result")).toContainText('"count"');
  await expect(page.locator(".query-result")).toContainText('"rows"');
});
