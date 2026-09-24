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

test("creates projects, sections, and routes tasks between them", async ({ page }, testInfo) => {
  const suffix = `${testInfo.workerIndex}-${Date.now()}`;
  const projectTitle = `Roadmap ${suffix}`;
  const sectionTitle = `Someday ${suffix}`;
  const projectTask = `Define project milestones ${suffix}`;
  const inboxTask = `Sort inbox item ${suffix}`;

  await page.goto("/");

  await createProject(page)(projectTitle);
  await expect(page.getByRole("button", { name: projectTitle })).toBeVisible();

  await page.getByRole("button", { name: projectTitle }).click();
  await expect(page.getByRole("heading", { name: projectTitle })).toBeVisible();

  await createTask(page)(projectTask);
  await expect(page.getByLabel(`${projectTitle} tasks`).getByText(projectTask)).toBeVisible();

  await page.getByRole("button", { name: "Inbox" }).click();
  await createSection(page)(sectionTitle);
  await expect(page.getByRole("heading", { name: sectionTitle })).toBeVisible();

  await createTask(page)(inboxTask);
  await page.getByRole("button", { name: `Edit task ${inboxTask}` }).click();
  await page.getByLabel(`Move ${inboxTask} to`).selectOption({ label: `Inbox / ${sectionTitle}` });
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByLabel(`Section ${sectionTitle}`).getByText(inboxTask)).toBeVisible();
});
