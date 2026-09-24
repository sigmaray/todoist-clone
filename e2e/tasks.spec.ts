import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const createTask = (page: Page) => async (title: string) => {
  await page.getByLabel(/Task title/).fill(title);
  await page.getByRole("button", { name: "Add task" }).click();
};

const createProject = (page: Page) => async (title: string) => {
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Add project" }).click();
};

const createSection = (page: Page) => async (title: string) => {
  await page.getByLabel("Section title").fill(title);
  await page.getByRole("button", { name: "Add section" }).click();
};

const dragTaskOntoTask = (page: Page) => async (sourceTitle: string, targetTitle: string) => {
  await page.getByText(sourceTitle).locator("..").evaluate(
    (sourceRow, target) => {
      const targetRow = [...document.querySelectorAll(".task-row")]
        .find((row) => row.textContent?.includes(target));
      const taskId = sourceRow.getAttribute("data-task-id");
      const dataTransfer = new DataTransfer();

      if (targetRow === undefined || taskId === null) {
        throw new Error("Unable to drag task");
      }

      dataTransfer.setData("text/task-id", taskId);
      sourceRow.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
      targetRow.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer }));
      targetRow.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer }));
      targetRow.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer }));
      sourceRow.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
    },
    targetTitle
  );
};

const dragTaskToRegion = (page: Page) => async (sourceTitle: string, regionLabel: string) => {
  await page.getByText(sourceTitle).locator("..").evaluate(
    (sourceRow, label) => {
      const region = [...document.querySelectorAll("[aria-label]")]
        .find((element) => element.getAttribute("aria-label") === label);
      const taskId = sourceRow.getAttribute("data-task-id");
      const dataTransfer = new DataTransfer();

      if (region === undefined || taskId === null) {
        throw new Error("Unable to drag task to region");
      }

      dataTransfer.setData("text/task-id", taskId);
      sourceRow.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
      region.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer }));
      region.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer }));
      sourceRow.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
    },
    regionLabel
  );
};

test("creates a task in the browser", async ({ page }, testInfo) => {
  const title = `Write the first MVP task ${testInfo.retry}-${Date.now()}`;
  const editedTitle = `Write the first persistent MVP task ${testInfo.retry}-${Date.now()}`;

  await page.goto("/");

  await createTask(page)(title);

  await expect(page.getByText(title)).toBeVisible();

  await page.getByRole("button", { name: `Edit task ${title}` }).click();
  await page.getByLabel(`Edit ${title}`).fill(editedTitle);
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText(editedTitle)).toBeVisible();

  await page.getByRole("button", { name: `Delete task ${editedTitle}` }).click();

  await expect(page.getByText(editedTitle)).not.toBeVisible();
});

test("creates projects, sections, subtasks, and exports markdown", async ({ context, page }, testInfo) => {
  const suffix = `${testInfo.workerIndex}-${Date.now()}`;
  const projectTitle = `Roadmap ${suffix}`;
  const sectionTitle = `Someday ${suffix}`;
  const projectTask = `Define project milestones ${suffix}`;
  const subtask = `Write launch notes ${suffix}`;
  const inboxTask = `Sort inbox item ${suffix}`;

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");

  await createProject(page)(projectTitle);
  await expect(page.getByRole("button", { name: projectTitle })).toBeVisible();

  await page.getByRole("button", { name: projectTitle }).click();
  await expect(page.getByRole("heading", { name: projectTitle })).toBeVisible();

  await createTask(page)(projectTask);
  await expect(page.getByLabel(`${projectTitle} tasks`).getByText(projectTask)).toBeVisible();

  await page.getByRole("button", { name: `Add subtask to ${projectTask}` }).click();
  await page.getByLabel(`Subtask for ${projectTask}`).fill(subtask);
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await expect(page.getByLabel(`${projectTitle} tasks`).getByText(subtask)).toBeVisible();

  await page.getByRole("button", { name: "Preview markdown" }).click();
  await expect(page.getByRole("dialog", { name: "Markdown preview" }).getByText(projectTask)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Markdown preview" }).getByText(subtask)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Inbox" }).click();
  await createSection(page)(sectionTitle);
  await expect(page.getByRole("heading", { name: sectionTitle })).toBeVisible();

  await page.getByRole("button", { name: `Edit section ${sectionTitle}` }).click();
  await page.getByLabel("Section title").last().fill(`${sectionTitle} edited`);
  await page.getByRole("button", { name: "Save section" }).click();
  await expect(page.getByRole("heading", { name: `${sectionTitle} edited` })).toBeVisible();

  await createTask(page)(inboxTask);
  await page.getByRole("button", { name: `Edit task ${inboxTask}` }).click();
  await page.getByLabel(`Move ${inboxTask} to`).selectOption({ label: `Inbox / ${sectionTitle} edited` });
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByLabel(`Section ${sectionTitle} edited`).getByText(inboxTask)).toBeVisible();

  await createTask(page)(`Loose child ${suffix}`);
  await dragTaskOntoTask(page)(`Loose child ${suffix}`, inboxTask);
  await expect(page.getByLabel(`Section ${sectionTitle} edited`).getByText(`Loose child ${suffix}`)).toBeVisible();
  await dragTaskToRegion(page)(`Loose child ${suffix}`, "Inbox tasks");
  await expect(page.getByLabel("Inbox tasks").getByText(`Loose child ${suffix}`)).toBeVisible();

  await page.getByRole("button", { name: "Copy markdown" }).click();
  await expect(page.getByText("Markdown copied")).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(inboxTask);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export all ZIP" }).click();
  await expect((await download).suggestedFilename()).toBe("todoist-clonse-markdown.zip");

  await page.getByRole("button", { name: `Delete section ${sectionTitle} edited` }).click();
  await expect(page.getByRole("heading", { name: `${sectionTitle} edited` })).not.toBeVisible();
});
