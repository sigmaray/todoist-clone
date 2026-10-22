import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
});

const createTask = (page: Page) => async (title: string) => {
  await page.getByRole("button", { name: "Add task Q" }).click();
  await page.getByLabel("New task title").fill(title);
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
};

const createProject = (page: Page) => async (title: string) => {
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Save", exact: true }).click();
};

const dragProjectTo = (page: Page) => async (sourceTitle: string, targetTitle: string, yRatio: number) => {
  await page.locator(".project-nav-row").filter({ has: page.getByRole("button", { name: sourceTitle, exact: true }) }).evaluate((source, data) => {
    const target = [...document.querySelectorAll<HTMLElement>(".project-nav-row")].find((row) => row.querySelector("button.nav-button")?.textContent?.trim() === data.targetTitle);
    if (!target) throw new Error("Project target not found");
    const rect = target.getBoundingClientRect();
    const y = rect.top + rect.height * data.yRatio;
    const transfer = new DataTransfer();
    transfer.setData("application/x-project-id", source.getAttribute("data-project-id") ?? "");
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: transfer, clientY: y }));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: transfer, clientY: y }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer, clientY: y }));
    source.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
  }, { targetTitle, yRatio });
};
const dragProjectWithMouse = (page: Page) => async (sourceTitle: string, targetTitle: string, yRatio: number) => {
  const source = page.locator(".project-nav-row").filter({ has: page.getByRole("button", { name: sourceTitle, exact: true }) });
  const target = page.locator(".project-nav-row").filter({ has: page.getByRole("button", { name: targetTitle, exact: true }) });
  const box = await target.boundingBox();
  if (!box) throw new Error("Project target is not visible");
  await source.dragTo(target, { targetPosition: { x: Math.max(8, Math.min(box.width - 8, box.width / 2)), y: Math.max(2, Math.min(box.height - 2, box.height * yRatio)) } });
};

const showProjectDropIndicator = (page: Page) => async (sourceTitle: string, targetTitle: string, yRatio: number) => {
  await page.locator(".project-nav-row").filter({ has: page.getByRole("button", { name: sourceTitle, exact: true }) }).evaluate((source, data) => {
    const target = [...document.querySelectorAll<HTMLElement>(".project-nav-row")].find((row) => row.querySelector("button.nav-button")?.textContent?.trim() === data.targetTitle);
    if (!target) throw new Error("Project target not found");
    const rect = target.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.setData("application/x-project-id", source.getAttribute("data-project-id") ?? "");
    const y = rect.top + rect.height * data.yRatio;
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: transfer, clientY: y }));
    const child = target.querySelector("button.nav-button");
    child?.dispatchEvent(new DragEvent("dragleave", { bubbles: true, dataTransfer: transfer, relatedTarget: target }));
  }, { targetTitle, yRatio });
};

const createSection = (page: Page) => async (title: string) => {
  await page.getByRole("button", { name: "Add section" }).click();
  await page.getByLabel("Section title").fill(title);
  await page.getByRole("button", { name: "Save", exact: true }).click();
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
  await expect(page.getByRole("button", { name: `Edit task ${title}` })).toHaveCSS("opacity", "1");

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

test("adds tasks directly to sections and deletes all tasks within Inbox or a project", async ({ page }, testInfo) => {
  const suffix = `${testInfo.workerIndex}-${Date.now()}`;
  const inboxSection = `Inbox section ${suffix}`;
  const inboxTask = `Inbox scoped task ${suffix}`;
  const inboxSectionTask = `Inbox section task ${suffix}`;
  const project = `Scoped project ${suffix}`;
  const projectSection = `Project section ${suffix}`;
  const projectTask = `Project scoped task ${suffix}`;
  const projectSectionTask = `Project section task ${suffix}`;

  await page.goto("/");
  await page.getByLabel("Inbox tasks").getByRole("button", { name: "Add task to Inbox" }).click();
  const inboxRootDialog = page.getByRole("dialog", { name: "Add task" });
  await expect(inboxRootDialog.getByLabel("Add task project")).toHaveValue("inbox");
  await inboxRootDialog.getByLabel("New task title").fill(inboxTask);
  await inboxRootDialog.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(inboxRootDialog).not.toBeVisible();
  await createSection(page)(inboxSection);
  const inboxSectionRegion = page.getByLabel(`Section ${inboxSection}`);
  await inboxSectionRegion.getByRole("button", { name: `Add task to section ${inboxSection}` }).click();
  const inboxSectionDialog = page.getByRole("dialog", { name: "Add task" });
  await expect(inboxSectionDialog.getByLabel("Add task project")).toHaveValue(/^section:/);
  await inboxSectionDialog.getByLabel("New task title").fill(inboxSectionTask);
  await inboxSectionDialog.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(inboxSectionRegion.getByText(inboxSectionTask)).toBeVisible();
  await expect(inboxSectionDialog).not.toBeVisible();

  await createProject(page)(project);
  await createSection(page)(projectSection);
  await page.getByLabel(`${project} tasks`).getByRole("button", { name: `Add task to ${project}` }).click();
  const projectRootDialog = page.getByRole("dialog", { name: "Add task" });
  await expect(projectRootDialog.getByLabel("Add task project")).toHaveValue(/^project:/);
  await projectRootDialog.getByLabel("New task title").fill(projectTask);
  await projectRootDialog.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(projectRootDialog).not.toBeVisible();
  const projectSectionRegion = page.getByLabel(`Section ${projectSection}`);
  await projectSectionRegion.getByRole("button", { name: `Add task to section ${projectSection}` }).click();
  const projectSectionDialog = page.getByRole("dialog", { name: "Add task" });
  await expect(projectSectionDialog.getByLabel("Add task project")).toHaveValue(/^section:/);
  await expect(projectSectionDialog.getByLabel("Add task project").locator("option", { hasText: `${project} / ${projectSection}` })).toHaveCount(1);
  await projectSectionDialog.getByLabel("New task title").fill(projectSectionTask);
  await projectSectionDialog.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(projectSectionRegion.getByText(projectSectionTask)).toBeVisible();

  await page.getByRole("button", { name: "Delete all tasks" }).click();
  await expect(page.getByRole("button", { name: projectTask, exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: projectSectionTask, exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: inboxTask, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete all tasks" }).click();
  await expect(page.getByRole("button", { name: inboxTask, exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: inboxSectionTask, exact: true })).not.toBeVisible();
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

  const projectSection = `Planning ${suffix}`;
  await page.getByRole("button", { name: "Add section" }).click();
  await page.getByLabel("Section title").fill(projectSection);
  await page.getByLabel("Section title").press("Enter");
  await expect(page.getByRole("heading", { name: projectSection, exact: true })).toBeVisible();

  await createTask(page)(projectTask);
  await expect(page.getByLabel(`${projectTitle} edited tasks`).getByText(projectTask)).toBeVisible();

  await page.getByRole("button", { name: `Edit task ${projectTask}` }).click();
  await expect(page.getByLabel(`Edit ${projectTask}`)).toHaveJSProperty("tagName", "TEXTAREA");
  await page.getByLabel(`Move ${projectTask} to`).selectOption({ label: `${projectTitle} edited / ${projectSection}` });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel(`Section ${projectSection}`).getByText(projectTask)).toBeVisible();

  await page.getByRole("button", { name: `Add subtask to ${projectTask}` }).click();
  await page.getByLabel(`Subtask for ${projectTask}`).fill(subtask);
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await expect(page.getByLabel(`Section ${projectSection}`).getByText(subtask)).toBeVisible();

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Preview markdown" }).click();
  const markdownPreview = page.getByRole("dialog", { name: "Markdown preview" });
  await expect(markdownPreview.getByText(projectTask)).toBeVisible();
  await expect(markdownPreview.getByText(subtask)).toBeVisible();
  const projectMarkdown = await markdownPreview.locator("pre").textContent() ?? "";
  expect(projectMarkdown.match(/^# /gm)).toHaveLength(1);
  expect(projectMarkdown).toContain(`## ${projectSection}`);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: "Export options" })).toBeVisible();
  await page.getByRole("button", { name: "Close export options" }).click();

  await page.getByRole("button", { name: "Inbox" }).click();
  await createSection(page)(sectionTitle);
  await expect(page.getByRole("heading", { name: sectionTitle })).toBeVisible();

  await page.getByRole("button", { name: `Edit section ${sectionTitle}` }).click();
  await page.getByLabel("Section title").last().fill(`${sectionTitle} edited`);
  await page.getByRole("button", { name: "Save section" }).click();
  await expect(page.getByRole("heading", { name: `${sectionTitle} edited` })).toBeVisible();

  await createTask(page)(inboxTask);
  await expect(page.getByRole("button", { name: inboxTask, exact: true })).toBeVisible();
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

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Copy markdown" }).click();
  await expect(page.locator('.export-options-modal [role="status"]')).toHaveText("Markdown copied");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(inboxTask);
  await page.getByRole("button", { name: "Close export options" }).click();

  await page.getByRole("link", { name: "Export", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Export" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export all ZIP" })).toHaveCount(0);
  const markdownDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export all markdown" }).click();
  expect((await markdownDownload).suggestedFilename()).toBe("todoist-clone.md");
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export all JSON" }).click();
  expect((await jsonDownload).suggestedFilename()).toBe("todoist-clone.json");
  await page.getByRole("button", { name: "Copy all JSON" }).click();
  await expect(page.locator(".export-page [role=status]")).toHaveText("All JSON copied");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('"taskTree"');
  await page.getByRole("button", { name: "Preview all JSON" }).click();
  await expect(page.getByRole("dialog", { name: "JSON preview" })).toContainText('"projects"');
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();

  await page.getByRole("button", { name: `Delete section ${sectionTitle} edited` }).click();
  await expect(page.getByRole("heading", { name: `${sectionTitle} edited` })).not.toBeVisible();

  await page.locator(`summary[aria-label="Project menu ${projectTitle} edited"]`).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("button", { name: `${projectTitle} edited`, exact: true })).not.toBeVisible();
});

test("creates subprojects and drags projects into and out of a parent", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.workerIndex}`;
  const root = `Root ${suffix}`;
  const child = `Child ${suffix}`;
  const grandchild = `Grandchild ${suffix}`;
  await page.goto("/");
  await createProject(page)(root);
  await page.locator(`summary[aria-label="Project menu ${root}"]`).click();
  await page.getByRole("button", { name: "＋ Add subproject" }).click();
  await page.getByLabel("Project title").fill(child);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".project-nav-row").filter({ hasText: child })).toHaveCSS("padding-inline-start", "18px");
  await page.locator(`summary[aria-label="Project menu ${child}"]`).click();
  await page.getByRole("button", { name: "＋ Add subproject" }).click();
  await page.getByLabel("Project title").fill(grandchild);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await dragProjectTo(page)(grandchild, root, 0.5);
  await expect(page.locator(".project-nav-row").filter({ hasText: grandchild })).toHaveCSS("padding-inline-start", "18px");
  await dragProjectTo(page)(grandchild, root, 0.1);
  await expect(page.locator(".project-nav-row").filter({ hasText: grandchild })).toHaveCSS("padding-inline-start", "0px");
  await page.reload();
  await expect(page.locator(".project-nav-row").filter({ has: page.getByRole("button", { name: grandchild, exact: true }) })).toHaveCSS("padding-inline-start", "0px");
});

test("reorders projects reliably before and after siblings and persists the order", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.workerIndex}`;
  const first = `Drag first ${suffix}`;
  const middle = `Drag middle ${suffix}`;
  const last = `Drag last ${suffix}`;
  await page.goto("/");
  await createProject(page)(first);
  await createProject(page)(middle);
  await createProject(page)(last);
  await dragProjectTo(page)(last, first, 0.1);
  await expect.poll(() => page.locator(".project-nav-row").evaluateAll((rows) => rows.map((row) => row.querySelector("button.nav-button")?.textContent?.trim()))).toContain(first);
  const order = async () => page.locator(".project-nav-row").evaluateAll((rows) => rows.map((row) => row.querySelector("button.nav-button")?.textContent?.trim()));
  await expect.poll(async () => {
    const rows = await order();
    return rows.indexOf(last) < rows.indexOf(first) && rows.indexOf(first) < rows.indexOf(middle);
  }).toBe(true);
  await dragProjectTo(page)(last, middle, 0.9);
  await expect.poll(async () => {
    const rows = await order();
    return rows.indexOf(first) < rows.indexOf(middle) && rows.indexOf(middle) < rows.indexOf(last);
  }).toBe(true);
  await page.reload();
  await expect.poll(async () => {
    const rows = await order();
    return rows.indexOf(first) < rows.indexOf(middle) && rows.indexOf(middle) < rows.indexOf(last);
  }).toBe(true);
});

test("keeps project drop feedback stable and blocks dragging a project into its descendant", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.workerIndex}`;
  const parent = `Drag parent ${suffix}`;
  const child = `Drag child ${suffix}`;
  const peer = `Drag peer ${suffix}`;
  await page.goto("/");
  await createProject(page)(parent);
  await createProject(page)(peer);
  await page.locator(`summary[aria-label="Project menu ${parent}"]`).click();
  await page.getByRole("button", { name: "＋ Add subproject" }).click();
  await page.getByLabel("Project title").fill(child);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await showProjectDropIndicator(page)(peer, parent, 0.5);
  await expect(page.locator(`.project-nav-row[data-project-id]`).filter({ has: page.getByRole("button", { name: parent, exact: true }) })).toHaveClass(/project-drop-inside/);
  await dragProjectTo(page)(peer, parent, 0.5);
  await expect(page.locator(".project-nav-row").filter({ has: page.getByRole("button", { name: peer, exact: true }) })).toHaveCSS("padding-inline-start", "18px");
  await dragProjectTo(page)(parent, child, 0.5);
  await expect(page.locator(".project-nav-row").filter({ has: page.getByRole("button", { name: parent, exact: true }) })).toHaveCSS("padding-inline-start", "0px");
  await expect(page.locator(".project-nav-row").filter({ has: page.getByRole("button", { name: child, exact: true }) })).toHaveCSS("padding-inline-start", "18px");
});

test("supports real mouse dragging of project rows", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.workerIndex}`;
  const first = `Mouse drag first ${suffix}`;
  const second = `Mouse drag second ${suffix}`;
  await page.goto("/");
  await createProject(page)(first);
  await createProject(page)(second);
  await dragProjectWithMouse(page)(second, first, 0.1);
  const rows = async () => page.locator(".project-nav-row").evaluateAll((items) => items.map((row) => row.querySelector("button.nav-button")?.textContent?.trim()));
  await expect.poll(async () => {
    const order = await rows();
    return order.indexOf(second) < order.indexOf(first);
  }).toBe(true);
  await page.reload();
  await expect.poll(async () => {
    const order = await rows();
    return order.indexOf(second) < order.indexOf(first);
  }).toBe(true);
});

test("nests a project with touch dragging in the mobile sidebar", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.workerIndex}`;
  const targetTitle = `Touch target ${suffix}`;
  const sourceTitle = `Touch source ${suffix}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await createProject(page)(targetTitle);
  await createProject(page)(sourceTitle);

  const sourceRow = page.locator(".project-nav-row").filter({ has: page.getByRole("button", { name: sourceTitle, exact: true }) });
  const targetRow = page.locator(".project-nav-row").filter({ has: page.getByRole("button", { name: targetTitle, exact: true }) });
  const sourceHandle = sourceRow.getByRole("button", { name: `Drag project ${sourceTitle}` });
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetRow.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Mobile project drag handles must be visible");
  const sourceId = await sourceRow.getAttribute("data-project-id");
  const targetId = await targetRow.getAttribute("data-project-id");
  if (!sourceId || !targetId) throw new Error("Project rows must expose their IDs");

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 }]
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 1, x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 }]
    });
    await expect(targetRow).toHaveClass(/project-drop-inside/);
    const movedProjectResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/projects/${sourceId}/parent`) && response.request().method() === "PATCH"
    );
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const response = await movedProjectResponse;
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ project: { id: sourceId, parentId: targetId } });
    await expect.poll(() => sourceRow.evaluate((row) => getComputedStyle(row).paddingInlineStart)).toBe("18px");
  } finally {
    await cdp.detach();
  }
});
