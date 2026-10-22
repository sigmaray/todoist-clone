import { expect, test } from "@playwright/test";

const unique = (prefix: string) => `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

test("task dialog, inline keyboard editing, navigation, search, and calendar work", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");

  const project = unique("Keyboard project");
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page.getByLabel("Project title")).toBeFocused();
  await page.getByLabel("Project title").fill("cancel this project");
  await page.getByLabel("Project title").press("Escape");
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByLabel("Project title").fill(project);
  await page.getByLabel("Project title").press("Enter");
  await expect(page.getByRole("button", { name: project, exact: true })).toBeVisible();

  const taskName = unique("Keyboard task");
  await page.getByRole("button", { name: /Add task/ }).click();
  const addDialog = page.getByRole("dialog", { name: "Add task" });
  await addDialog.getByLabel("New task title").fill(taskName);
  await addDialog.getByLabel("New task description").fill("Details from the quick add dialog");
  await addDialog.getByLabel("Add task project").selectOption({ label: project });
  await addDialog.getByLabel("New task date").fill("2026-11-18");
  await addDialog.getByLabel("New task labels").fill("focus, work");
  await addDialog.getByRole("button", { name: "Add task", exact: true }).click();

  await page.getByRole("button", { name: project, exact: true }).click();
  await expect(page.getByRole("button", { name: taskName, exact: true })).toBeVisible();
  await page.getByRole("button", { name: taskName, exact: true }).click();
  const details = page.getByRole("dialog", { name: `Task details: ${taskName}` });
  await page.keyboard.press("Escape");
  await expect(details).not.toBeVisible();

  await page.getByRole("button", { name: `Edit task ${taskName}` }).click();
  const taskEditor = page.getByLabel(`Edit ${taskName}`);
  await expect(taskEditor).toBeFocused();
  await taskEditor.fill("cancelled title");
  await taskEditor.press("Escape");
  await expect(page.getByRole("button", { name: taskName, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Edit task ${taskName}` }).click();
  const savedTaskName = unique("Saved task");
  await page.getByLabel(`Edit ${taskName}`).fill(savedTaskName);
  await page.getByLabel(`Edit ${taskName}`).press("Enter");
  await expect(page.getByRole("button", { name: savedTaskName, exact: true })).toBeVisible();

  await page.locator(`summary[aria-label="Project menu ${project}"]`).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const projectEditor = page.locator('input[id^="project-edit-"]');
  await expect(projectEditor).toBeFocused();
  await projectEditor.fill("cancel project");
  await projectEditor.press("Escape");
  await expect(page.getByRole("button", { name: project, exact: true })).toBeVisible();
  await page.locator(`summary[aria-label="Project menu ${project}"]`).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const renamedProject = unique("Renamed project");
  await page.locator('input[id^="project-edit-"]').fill(renamedProject);
  await page.locator('input[id^="project-edit-"]').press("Enter");
  await expect(page.getByRole("button", { name: renamedProject, exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  const sectionName = unique("Section");
  await page.getByRole("button", { name: "Add section" }).click();
  await expect(page.getByLabel("Section title")).toBeFocused();
  await page.getByLabel("Section title").fill("cancel this section");
  await page.getByLabel("Section title").press("Escape");
  await page.getByRole("button", { name: "Add section" }).click();
  await page.getByLabel("Section title").fill(sectionName);
  await page.getByLabel("Section title").press("Enter");
  await page.getByRole("button", { name: `Edit section ${sectionName}` }).click();
  await expect(page.locator('input[id^="section-edit-"]')).toBeFocused();
  await page.locator('input[id^="section-edit-"]').fill("discard section");
  await page.locator('input[id^="section-edit-"]').press("Escape");
  await expect(page.getByRole("heading", { name: sectionName, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Edit section ${sectionName}` }).click();
  const renamedSection = unique("Renamed section");
  await page.locator('input[id^="section-edit-"]').fill(renamedSection);
  await page.locator('input[id^="section-edit-"]').press("Enter");
  await expect(page.getByRole("heading", { name: renamedSection, exact: true })).toBeVisible();

  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Search or type a command" }).fill(renamedProject);
  await expect(page.locator(".search-palette .search-result").filter({ hasText: renamedProject })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Search or type a command" }).fill(renamedSection);
  await expect(page.locator(".search-palette .search-result").filter({ hasText: renamedSection })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/dates");
  await expect(page.getByRole("button", { name: "Inbox", exact: true })).not.toHaveClass(/active/);
  await expect(page.getByRole("link", { name: "Dates" })).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: "Copy markdown" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preview markdown" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Dates" }).locator("svg")).toBeVisible();
  await expect(page.getByRole("link", { name: "Labels", exact: true }).locator("svg")).toBeVisible();
  await expect(page.getByRole("button", { name: savedTaskName, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Calendar" }).click();
  await expect(page.getByLabel("Calendar view")).toBeVisible();
  await page.getByRole("button", { name: "List" }).click();
  await page.goto("/labels");
  await expect(page.getByRole("button", { name: "Inbox", exact: true })).not.toHaveClass(/active/);
  await expect(page.getByRole("link", { name: "Labels", exact: true })).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: "Copy markdown" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preview markdown" })).toHaveCount(0);
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/settings");
  const settingsNav = page.getByLabel("Navigation");
  await expect(settingsNav.getByRole("link", { name: "Dates" })).toBeVisible();
  await expect(settingsNav.getByRole("link", { name: "Labels", exact: true })).toBeVisible();
  await expect(settingsNav.getByRole("link", { name: renamedProject })).toBeVisible();

  await page.keyboard.press("q");
  const quickDialog = page.getByRole("dialog", { name: "Add task" });
  await expect(quickDialog).toBeVisible();
  await quickDialog.getByLabel("New task title").fill(unique("Q task"));
  await quickDialog.getByRole("button", { name: "Add task", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "й", bubbles: true })));
  await expect(page.getByRole("dialog", { name: "Add task" })).toBeVisible();
});
