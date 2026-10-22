import { expect, test } from "@playwright/test";

const localIsoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

test("month calendar stays readable on mobile and moves tasks between days", async ({ page, request }, testInfo) => {
  const title = `Calendar task ${Date.now()}-${testInfo.workerIndex}`;
  const todayDate = new Date();
  const tomorrowDate = new Date(todayDate);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const today = localIsoDate(todayDate);
  const tomorrow = localIsoDate(tomorrowDate);
  const createdResponse = await request.post("/tasks", { data: { title, projectId: null, sectionId: null, parentId: null } });
  expect(createdResponse.ok()).toBe(true);
  const created = await createdResponse.json() as Readonly<{ task: Readonly<{ id: string }> }>;

  try {
    const datedResponse = await request.patch(`/tasks/${created.task.id}`, { data: { dueDate: today } });
    expect(datedResponse.ok()).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dates");
    await page.getByRole("button", { name: "Calendar" }).click();

    await expect(page.getByRole("columnheader")).toHaveText(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    await expect(page.getByRole("gridcell")).toHaveCount(42);
    await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
    const todayNumber = page.locator('.dates-calendar-day.today [aria-current="date"]');
    await expect(todayNumber).toBeVisible();
    await expect.poll(() => todayNumber.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(214, 54, 43)");
    await expect(page.locator(".dates-calendar-scroll").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).resolves.toBe(true);

    const source = page.locator(`section[aria-label="Tasks for ${today}"]`);
    const destination = page.locator(`section[aria-label="Tasks for ${tomorrow}"]`);
    await expect(source.getByRole("button", { name: title, exact: true })).toBeVisible();
    await expect(source.getByText("Inbox")).toHaveCount(1);
    const viewportWidth = page.viewportSize()?.width ?? 0;
    const todayBox = await source.boundingBox();
    const taskBox = await source.getByRole("button", { name: title, exact: true }).boundingBox();
    expect(todayBox).not.toBeNull();
    expect(taskBox).not.toBeNull();
    expect(todayBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((todayBox?.x ?? viewportWidth) + (todayBox?.width ?? 1)).toBeLessThanOrEqual(viewportWidth);
    expect(taskBox?.x ?? -1).toBeGreaterThanOrEqual(todayBox?.x ?? 0);
    expect((taskBox?.x ?? viewportWidth) + (taskBox?.width ?? 1)).toBeLessThanOrEqual((todayBox?.x ?? 0) + (todayBox?.width ?? viewportWidth));
    await source.getByRole("button", { name: title, exact: true }).dragTo(destination);
    await expect(destination.getByRole("button", { name: title, exact: true })).toBeVisible();
    await expect(source.getByRole("button", { name: title, exact: true })).toHaveCount(0);
  } finally {
    await request.delete(`/tasks/${created.task.id}`);
  }
});
