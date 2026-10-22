import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
});

const createTask = (page: Page) => async (title: string) => {
  await page.getByRole("button", { name: "Add task Q" }).click();
  await page.getByLabel("New task title").fill(title);
  await page.getByRole("button", { name: "Add task", exact: true }).click();
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

      const rect = targetRow.getBoundingClientRect();
      const middleY = rect.top + rect.height / 2;
      const middleX = rect.left + Math.max(48, rect.width / 3);

      dataTransfer.setData("text/task-id", taskId);
      sourceRow.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer, clientX: middleX, clientY: middleY }));
      targetRow.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer, clientX: middleX, clientY: middleY }));
      targetRow.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer, clientX: middleX, clientY: middleY }));
      targetRow.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer, clientX: middleX, clientY: middleY }));
      sourceRow.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer, clientX: middleX, clientY: middleY }));
    },
    targetTitle
  );
};

const dragTaskBeforeTask = (page: Page) => async (sourceTitle: string, targetTitle: string) => {
  await page.getByText(sourceTitle).locator("..").evaluate(
    (sourceRow, target) => {
      const targetRow = [...document.querySelectorAll(".task-row")]
        .find((row) => row.textContent?.includes(target));
      const taskId = sourceRow.getAttribute("data-task-id");
      const dataTransfer = new DataTransfer();

      if (targetRow === undefined || taskId === null) {
        throw new Error("Unable to reorder task");
      }

      const rect = targetRow.getBoundingClientRect();
      const topY = rect.top + Math.max(1, rect.height * 0.1);
      const middleX = rect.left + Math.max(48, rect.width / 3);

      dataTransfer.setData("text/task-id", taskId);
      sourceRow.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer, clientX: middleX, clientY: topY }));
      targetRow.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer, clientX: middleX, clientY: topY }));
      targetRow.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer, clientX: middleX, clientY: topY }));
      targetRow.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer, clientX: middleX, clientY: topY }));
      sourceRow.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer, clientX: middleX, clientY: topY }));
    },
    targetTitle
  );
};

const dragTaskOverProject = (page: Page) => async (sourceTitle: string, projectTitle: string) => {
  await page.getByText(sourceTitle).locator("..").evaluate(
    (sourceRow, title) => {
      const projectButton = [...document.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === title);
      const taskId = sourceRow.getAttribute("data-task-id");
      const dataTransfer = new DataTransfer();

      if (projectButton === undefined || taskId === null) {
        throw new Error("Unable to drag task over project");
      }

      dataTransfer.setData("text/task-id", taskId);
      sourceRow.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
      projectButton.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer }));
      projectButton.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer }));
    },
    projectTitle
  );
};

const dragTaskLeftOnItself = (page: Page) => async (title: string) => {
  await page.getByText(title).locator("..").evaluate((sourceRow) => {
    const taskId = sourceRow.getAttribute("data-task-id");
    const rect = sourceRow.getBoundingClientRect();
    const dataTransfer = new DataTransfer();

    if (taskId === null) {
      throw new Error("Unable to drag task left");
    }

    dataTransfer.setData("text/task-id", taskId);
    sourceRow.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer, clientX: rect.left }));
    sourceRow.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer, clientX: rect.left - 40 }));
    sourceRow.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer, clientX: rect.left - 40 }));
    sourceRow.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer, clientX: rect.left - 40 }));
    sourceRow.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer, clientX: rect.left - 40 }));
  });
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

test("opens settings with deletion confirmation enabled by default", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Ask for confirmation before deleting/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Anonymous access/ })).toBeChecked();
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
  await expect(page.getByRole("link", { name: "Tools" })).toHaveAttribute("href", "/tools");

  await createProject(page)(projectTitle);
  await expect(page.getByRole("button", { name: projectTitle, exact: true })).toBeVisible();

  await page.locator(`summary[aria-label="Project menu ${projectTitle}"]`).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Project title").first().fill(`${projectTitle} edited`);
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(page.getByRole("button", { name: `${projectTitle} edited`, exact: true })).toBeVisible();

  await page.getByRole("button", { name: `${projectTitle} edited`, exact: true }).click();
  await expect(page.getByRole("heading", { name: `${projectTitle} edited` })).toBeVisible();

  await createTask(page)(projectTask);
  await expect(page.getByLabel(`${projectTitle} edited tasks`).getByText(projectTask)).toBeVisible();

  await page.getByRole("button", { name: `Add subtask to ${projectTask}` }).click();
  await page.getByLabel(`Subtask for ${projectTask}`).fill(subtask);
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await expect(page.getByLabel(`${projectTitle} edited tasks`).getByText(subtask)).toBeVisible();

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
  await dragTaskOverProject(page)(inboxTask, `${projectTitle} edited`);
  await expect(page.getByRole("button", { name: `${projectTitle} edited`, exact: true })).toHaveClass(/drop-active/);
  await page.getByRole("button", { name: `Edit task ${inboxTask}` }).click();
  await page.getByLabel(`Move ${inboxTask} to`).selectOption({ label: `Inbox / ${sectionTitle} edited` });
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByLabel(`Section ${sectionTitle} edited`).getByText(inboxTask)).toBeVisible();

  await createTask(page)(`Loose child ${suffix}`);
  await dragTaskOntoTask(page)(`Loose child ${suffix}`, inboxTask);
  await expect(page.getByLabel(`Section ${sectionTitle} edited`).getByText(`Loose child ${suffix}`)).toBeVisible();
  await dragTaskToRegion(page)(`Loose child ${suffix}`, "Inbox tasks");
  await expect(page.getByLabel("Inbox tasks").getByText(`Loose child ${suffix}`)).toBeVisible();

  const firstOrderTask = `Order first ${suffix}`;
  const secondOrderTask = `Order second ${suffix}`;

  await createTask(page)(firstOrderTask);
  await createTask(page)(secondOrderTask);
  await dragTaskBeforeTask(page)(secondOrderTask, firstOrderTask);
  await expect(page.getByLabel("Inbox tasks").locator(".task-title").filter({ hasText: secondOrderTask })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        ({ before, after }) => {
          const rows = [...document.querySelectorAll(".task-row")];
          const beforeIndex = rows.findIndex((row) => row.textContent?.includes(before));
          const afterIndex = rows.findIndex((row) => row.textContent?.includes(after));

          return beforeIndex >= 0 && afterIndex >= 0 ? beforeIndex < afterIndex : false;
        },
        { before: secondOrderTask, after: firstOrderTask }
      )
    )
    .toBe(true);

  await page.getByText(firstOrderTask).locator("..").focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowRight" : "Control+ArrowRight");
  await expect(page.getByText(firstOrderTask).locator("..")).toHaveCSS("padding-left", "20px");
  await page.getByText(firstOrderTask).locator("..").focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowLeft" : "Control+ArrowLeft");
  await expect(page.getByText(firstOrderTask).locator("..")).toHaveCSS("padding-left", "0px");

  const dragParent = `Drag parent ${suffix}`;
  const dragChild = `Drag child ${suffix}`;

  await createTask(page)(dragParent);
  await createTask(page)(dragChild);
  await dragTaskOntoTask(page)(dragChild, dragParent);
  await expect(page.getByText(dragChild).locator("..")).toHaveCSS("padding-left", "20px");
  await dragTaskLeftOnItself(page)(dragChild);
  await expect(page.getByText(dragChild).locator("..")).toHaveCSS("padding-left", "0px");

  await page.getByRole("button", { name: "Copy markdown" }).click();
  await expect(page.getByText("Markdown copied")).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(inboxTask);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export all ZIP" }).click();
  await expect((await download).suggestedFilename()).toBe("todoist-clone-markdown.zip");

  await page.getByRole("button", { name: `Delete section ${sectionTitle} edited` }).click();
  await expect(page.getByRole("heading", { name: `${sectionTitle} edited` })).not.toBeVisible();

  await page.locator(`summary[aria-label="Project menu ${projectTitle} edited"]`).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("button", { name: `${projectTitle} edited`, exact: true })).not.toBeVisible();
});
