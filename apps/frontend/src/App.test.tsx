import { QueryClientProvider } from "@tanstack/react-query";
import type { Project, Section, Task, TaskNode } from "@todoist-clone/domain";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, SettingsPage, TaskApp, ToolsPage } from "./App";
import { createTaskApi } from "./api";
import type { ApplicationApi, ToolsApi } from "./api";

const task = (values: Partial<TaskNode> & Pick<TaskNode, "id" | "title">): TaskNode =>
  Object.freeze({
    description: "",
    dueDate: null,
    labels: Object.freeze([]),
    comments: Object.freeze([]),
    completed: false,
    parentId: null,
    projectId: null,
    sectionId: null,
    lexicalOrder: "U",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    children: Object.freeze([]),
    ...values
  });

const project = (values: Partial<Project> & Pick<Project, "id" | "title">): Project =>
  Object.freeze({
    description: "",
    archived: false,
    lexicalOrder: "U",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...values
  });

const section = (values: Partial<Section> & Pick<Section, "id" | "title">): Section =>
  Object.freeze({
    projectId: null,
    lexicalOrder: "U",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...values
  });

const renderApp = (api: ApplicationApi) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TaskApp api={api} />
    </QueryClientProvider>
  );

const baseApi = (tasks: ReadonlyArray<TaskNode>): ApplicationApi =>
  Object.freeze({
    getSettings: async () => Object.freeze({ confirmDelete: true, accessMode: "anonymous" as const, username: null }),
    updateSettings: async (settings) => Object.freeze({ confirmDelete: settings.confirmDelete, accessMode: settings.accessMode, username: settings.username }),
    getAuthStatus: async () => Object.freeze({ accessMode: "anonymous" as const, authenticated: true }),
    login: async () => undefined,
    logout: async () => undefined,
    listTasks: async () => tasks,
    listProjects: async () => Object.freeze([]),
    createProject: async (title) =>
      Object.freeze({
        id: "project",
        title,
        description: "",
        archived: false,
        lexicalOrder: "U",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }),
    reorderProject: async (id) => project({ id, title: "Reordered" }),
    updateProject: async (id, patch) => project({ id, title: patch.title ?? "Project", description: patch.description ?? "" }),
    getInboxDescription: async () => "",
    updateInboxDescription: async () => undefined,
    duplicateProject: async (id) => project({ id: `${id}-copy`, title: "Project copy" }),
    archiveProject: async (id, archived) => project({ id, title: "Project", archived }),
    deleteProject: async () => undefined,
    listSections: async () => Object.freeze([]),
    createSection: async (title, projectId) =>
      Object.freeze({
        id: "section",
        title,
        projectId,
        lexicalOrder: "U",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }),
    reorderSection: async (id, beforeId, afterId) => Object.freeze({ id, title: "Reordered", projectId: null, lexicalOrder: beforeId ?? afterId ?? "U", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }),
    updateSection: async (id, title) =>
      Object.freeze({
        id,
        title,
        projectId: null,
        lexicalOrder: "U",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }),
    deleteSection: async () => undefined,
    createTask: async (title, projectId, sectionId, parentId): Promise<Task> => task({ id: "created", title, projectId, sectionId, parentId }),
    patchTask: async (id, completed): Promise<Task> => task({ id, title: "Plan MVP", completed }),
    updateTask: async (id, patch): Promise<Task> => task({ id, title: patch.title ?? "Plan MVP" }),
    moveTask: async (id, projectId, sectionId, parentId): Promise<Task> => task({ id, title: "Moved", projectId, sectionId, parentId }),
    deleteTask: async () => undefined
  });

const dragTask = (title: string) => {
  const data = new Map<string, string>();
  const dataTransfer = Object.freeze({
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? ""
  });
  const row = screen.getByText(title).closest(".task-row");

  if (row === null) {
    throw new Error(`Unable to find row for ${title}`);
  }

  fireEvent.dragStart(row, { dataTransfer });

  return dataTransfer;
};

const taskRow = (title: string) => {
  const row = screen.getByText(title).closest(".task-row");

  if (row === null) {
    throw new Error(`Unable to find row for ${title}`);
  }

  return row;
};

const placePointer = (row: Element, top = 0) => {
  Object.defineProperty(row, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      Object.freeze({
      x: 0,
      y: top,
      top,
      right: 400,
      bottom: top + 100,
      left: 0,
      width: 400,
      height: 100,
      toJSON: () => Object.freeze({})
    })
  });
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("TaskApp", () => {
  it("renders a task list", async () => {
    renderApp(baseApi(Object.freeze([task({ id: "1", title: "Plan MVP" })])));

    expect(await screen.findByText("Plan MVP")).toBeInTheDocument();
  });

  it("edits text on demand with Save, Cancel, Enter and Escape, and edits dates and labels", async () => {
    const updateTask = vi.fn(async (id: string, patch: Parameters<ApplicationApi["updateTask"]>[1]): Promise<Task> => task({ id, title: patch.title ?? "Plan MVP", description: patch.description ?? "", dueDate: patch.dueDate ?? null, labels: patch.labels ?? [], comments: patch.comments ?? [] }));
    renderApp(Object.freeze({ ...baseApi(Object.freeze([task({ id: "task-1", title: "Plan MVP" })])), updateTask }));
    await userEvent.click(await screen.findByRole("button", { name: "Plan MVP" }));
    const dialog = screen.getByRole("dialog", { name: "Task details: Plan MVP" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Edit task title" }));
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Edit task title" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Edit task title" }), "Plan launch{Enter}");
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("task-1", { title: "Plan launch" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Edit task description" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Edit task description" }), "Ship release{Enter}");
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("task-1", { description: "Ship release" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Edit task description" }));
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Edit task description" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Edit task description" }), "discard{Escape}");
    expect(within(dialog).getByRole("button", { name: "Edit task description" })).toHaveTextContent("Ship release");
    await userEvent.click(within(dialog).getByRole("button", { name: /Add date/ }));
    fireEvent.change(screen.getByLabelText("New date"), { target: { value: "2026-11-01" } });
    await userEvent.click(within(screen.getByRole("dialog", { name: "Change date" })).getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("task-1", { dueDate: "2026-11-01" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Add label" }));
    await userEvent.type(within(dialog).getByLabelText("Labels"), "work{Enter}");
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("task-1", { labels: ["work"] }));
    await userEvent.type(within(dialog).getByLabelText("Add comment"), "Looks good");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add comment" }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("task-1", expect.objectContaining({ comments: [expect.objectContaining({ body: "Looks good" })] })));
    expect(within(dialog).queryByRole("button", { name: "Save task" })).not.toBeInTheDocument();
  });

  it("shows task location and parent links, and moves tasks between Inbox and projects", async () => {
    const moveTask = vi.fn(async (id: string, projectId: string | null, sectionId: string | null): Promise<Task> => task({ id, title: "Child task", projectId, sectionId }));
    const parent = task({ id: "parent-1", title: "Parent task", children: Object.freeze([task({ id: "child-1", title: "Child task", parentId: "parent-1" })]) });
    renderApp(Object.freeze({
      ...baseApi(Object.freeze([parent])),
      listProjects: async () => Object.freeze([project({ id: "project-1", title: "Roadmap" }), project({ id: "project-2", title: "Alpha" })]),
      listSections: async () => Object.freeze([section({ id: "section-1", title: "Next", projectId: "project-1" }), section({ id: "section-2", title: "Back", projectId: "project-1" })]),
      moveTask
    }));

    await userEvent.click(await screen.findByRole("button", { name: "Child task" }));
    const dialog = screen.getByRole("dialog", { name: "Task details: Child task" });
    expect(within(dialog).getAllByRole("link", { name: "Inbox" })[0]).toHaveAttribute("href", "/");
    expect(within(dialog).getByRole("link", { name: "Parent task" })).toHaveAttribute("href", "/?task=parent-1");
    const locationPicker = within(dialog).getByLabelText("Project, section, or Inbox");
    expect(within(locationPicker).getAllByRole("option").map((option) => option.textContent)).toEqual(["Alpha", "Inbox", "Roadmap", "Roadmap / Back", "Roadmap / Next"]);
    await userEvent.selectOptions(locationPicker, "project:project-1");
    await waitFor(() => expect(moveTask).toHaveBeenCalledWith("child-1", "project-1", null, null, null, null));
    expect(locationPicker).toHaveValue("project:project-1");
    expect(within(dialog).getByRole("option", { name: "Roadmap / Next" })).toBeInTheDocument();
    await userEvent.selectOptions(locationPicker, "section:section-1");
    await waitFor(() => expect(moveTask).toHaveBeenCalledWith("child-1", "project-1", "section-1", null, null, null));
    expect(locationPicker).toHaveValue("section:section-1");
    expect(within(dialog).queryByRole("navigation", { name: "Task location" })).not.toBeInTheDocument();
  });

  it("calls the create handler when a task is submitted", async () => {
    const createTask = vi.fn(async (title: string): Promise<Task> => task({ id: "created", title }));

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([])),
        createTask,
      })
    );

    await userEvent.click(screen.getByRole("button", { name: "Add task Q" }));
    await userEvent.type(screen.getByLabelText("New task title"), "Write tests");
    await userEvent.click(within(screen.getByRole("dialog", { name: "Add task" })).getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledWith("Write tests", null, null, null));
  });

  it("creates projects and sends new tasks to the selected project", async () => {
    let projects = Object.freeze([] as ReadonlyArray<Project>);
    const createTask = vi.fn(async (title: string, projectId: string | null, sectionId: string | null, parentId: string | null): Promise<Task> =>
      task({ id: "created", title, projectId, sectionId, parentId })
    );
    const createProject = vi.fn(async (title: string): Promise<Project> => {
      const created = project({ id: "project-1", title });
      projects = Object.freeze([...projects, created]);

      return created;
    });

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([])),
        listProjects: async () => projects,
        createProject,
        createTask
      })
    );

    await userEvent.click(screen.getByRole("button", { name: "Add project" }));
    await userEvent.type(screen.getByLabelText("Project title"), "Roadmap");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(await screen.findByRole("button", { name: "Roadmap" }));
    await userEvent.click(screen.getByRole("button", { name: "Add task Q" }));
    await userEvent.type(screen.getByLabelText("New task title"), "Define milestones");
    await userEvent.click(within(screen.getByRole("dialog", { name: "Add task" })).getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledWith("Define milestones", "project-1", null, null));
  });

  it("creates subtasks under an existing task", async () => {
    const createTask = vi.fn(
      async (title: string, projectId: string | null, sectionId: string | null, parentId: string | null): Promise<Task> =>
        task({ id: "subtask-1", title, projectId, sectionId, parentId })
    );

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([task({ id: "task-1", title: "Plan MVP" })])),
        createTask
      })
    );

    await screen.findByText("Plan MVP");
    await userEvent.click(screen.getByRole("button", { name: "Add subtask to Plan MVP" }));
    expect(screen.getByLabelText("Subtask for Plan MVP")).toHaveFocus();
    await userEvent.type(screen.getByLabelText("Subtask for Plan MVP"), "Write outline");
    await userEvent.click(screen.getByRole("button", { name: "Add subtask" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledWith("Write outline", null, null, "task-1"));
  });

  it("shows a created project from the create response", async () => {
    const createProject = vi.fn(async (title: string): Promise<Project> => project({ id: "project-1", title }));

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([])),
        listProjects: async () => Object.freeze([]),
        createProject
      })
    );

    await userEvent.click(screen.getByRole("button", { name: "Add project" }));
    await userEvent.type(screen.getByLabelText("Project title"), "Roadmap");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith("Roadmap"));
    expect(await screen.findByRole("button", { name: "Roadmap" })).toBeInTheDocument();
  });

  it("updates and deletes projects from the sidebar", async () => {
    const updateProject = vi.fn(async (id: string, patch: Readonly<{ title?: string; description?: string }>): Promise<Project> => project({ id, title: patch.title ?? "Roadmap", description: patch.description ?? "" }));
    const deleteProject = vi.fn(async () => undefined);

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([])),
        listProjects: async () => Object.freeze([project({ id: "project-1", title: "Roadmap" })]),
        updateProject,
        deleteProject
      })
    );

    await screen.findByRole("button", { name: "Roadmap" });
    await userEvent.click(screen.getByLabelText("Project menu Roadmap"));
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("button", { name: "Save project" });
    const editInput = screen.getAllByLabelText("Project title").at(0);

    if (editInput === undefined) {
      throw new Error("Missing project edit input");
    }

    await userEvent.clear(editInput);
    await userEvent.type(editInput, "Launch plan");
    await userEvent.click(screen.getByRole("button", { name: "Save project" }));

    await waitFor(() => expect(updateProject).toHaveBeenCalledWith("project-1", { id: "project-1", title: "Launch plan" }));

    await userEvent.click(screen.getByLabelText("Project menu Launch plan"));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith("project-1"));
  });

  it("saves, edits, and removes the Inbox description", async () => {
    let description = "";
    renderApp(Object.freeze({
      ...baseApi(Object.freeze([])),
      getInboxDescription: async () => description,
      updateInboxDescription: async (next) => { description = next; }
    }));

    await userEvent.click(await screen.findByRole("button", { name: "Add description" }));
    await userEvent.type(screen.getByLabelText("Scope description"), "Inbox notes");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Inbox notes")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit description" }));
    await userEvent.clear(screen.getByLabelText("Scope description"));
    await userEvent.type(screen.getByLabelText("Scope description"), "Updated notes");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Updated notes")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete description" }));
    expect(await screen.findByRole("button", { name: "Add description" })).toBeInTheDocument();
  });

  it("closes an open project menu with Escape and outside click", async () => {
    renderApp(Object.freeze({ ...baseApi(Object.freeze([])), listProjects: async () => Object.freeze([project({ id: "project-1", title: "Roadmap" })]) }));
    await screen.findByRole("button", { name: "Roadmap" });
    const menu = screen.getByLabelText("Project menu Roadmap").parentElement;
    if (menu === null) throw new Error("Missing project menu");

    await userEvent.click(screen.getByLabelText("Project menu Roadmap"));
    expect(within(menu).getByRole("button", { name: "Duplicate" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(menu).not.toHaveAttribute("open"));

    await userEvent.click(screen.getByLabelText("Project menu Roadmap"));
    expect(within(menu).getByRole("button", { name: "Duplicate" })).toBeVisible();
    await userEvent.click(screen.getByRole("heading", { name: "Inbox", level: 1 }));
    await waitFor(() => expect(menu).not.toHaveAttribute("open"));
  });

  it("creates inbox sections and moves inbox tasks into them", async () => {
    let sections = Object.freeze([] as ReadonlyArray<Section>);
    const moveTask = vi.fn(async (id: string, projectId: string | null, sectionId: string | null, parentId: string | null): Promise<Task> =>
      task({ id, title: "Sort receipts", projectId, sectionId, parentId })
    );

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([task({ id: "task-1", title: "Sort receipts" })])),
        listSections: async () => sections,
        createSection: async (title) => {
          const created = section({ id: "section-1", title });
          sections = Object.freeze([...sections, created]);

          return created;
        },
        moveTask
      })
    );

    await userEvent.click(screen.getByRole("button", { name: "Add section" }));
    await userEvent.type(screen.getByLabelText("Section title"), "Later");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const dataTransfer = dragTask("Sort receipts");
    fireEvent.drop(await screen.findByLabelText("Section Later"), { dataTransfer });

    await waitFor(() => expect(moveTask).toHaveBeenCalledWith("task-1", null, "section-1", null, null, null));
  });

  it("shows a created inbox section from the create response", async () => {
    const createSection = vi.fn(async (title: string): Promise<Section> => section({ id: "section-1", title }));

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([])),
        listSections: async () => Object.freeze([]),
        createSection
      })
    );

    await userEvent.click(screen.getByRole("button", { name: "Add section" }));
    await userEvent.type(screen.getByLabelText("Section title"), "Someday");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createSection).toHaveBeenCalledWith("Someday", null));
    expect(await screen.findByRole("heading", { name: "Someday" })).toBeInTheDocument();
  });

  it("moves tasks between inbox and projects with drag and drop", async () => {
    const moveTask = vi.fn(async (id: string, projectId: string | null, sectionId: string | null, parentId: string | null): Promise<Task> =>
      task({ id, title: "Plan launch", projectId, sectionId, parentId })
    );

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([task({ id: "task-1", title: "Plan launch", projectId: "project-1" })])),
        listProjects: async () => Object.freeze([project({ id: "project-1", title: "Launch" })]),
        moveTask
      })
    );

    await userEvent.click(await screen.findByRole("button", { name: "Launch" }));

    const dataTransfer = dragTask("Plan launch");
    fireEvent.drop(screen.getByRole("button", { name: "Inbox" }), { dataTransfer });

    await waitFor(() => expect(moveTask).toHaveBeenCalledWith("task-1", null, null, null, null, null));
  });

  it("highlights a project while a task is dragged over it", async () => {
    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([task({ id: "task-1", title: "Plan launch" })])),
        listProjects: async () => Object.freeze([project({ id: "project-1", title: "Launch" })])
      })
    );

    await screen.findByText("Plan launch");
    const dataTransfer = dragTask("Plan launch");
    const projectButton = await screen.findByRole("button", { name: "Launch" });

    fireEvent.dragEnter(projectButton, { dataTransfer });

    expect(projectButton).toHaveClass("drop-active");
  });

  it("moves a task inside another task with drag and drop", async () => {
    const moveTask = vi.fn(async (id: string, projectId: string | null, sectionId: string | null, parentId: string | null): Promise<Task> =>
      task({ id, title: "Child", projectId, sectionId, parentId })
    );

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([
          task({ id: "parent", title: "Parent task" }),
          task({ id: "child", title: "Child task" })
        ])),
        moveTask
      })
    );

    await screen.findByText("Parent task");
    const dataTransfer = dragTask("Child task");
    const parentRow = taskRow("Parent task");

    placePointer(parentRow, -50);
    fireEvent.drop(parentRow, { dataTransfer });

    await waitFor(() => expect(moveTask).toHaveBeenCalledWith("child", null, null, "parent", null, null));
  });

  it("reorders sibling tasks with drag and drop insertion lines", async () => {
    const moveTask = vi.fn(async (id: string, projectId: string | null, sectionId: string | null, parentId: string | null): Promise<Task> =>
      task({ id, title: "Moved", projectId, sectionId, parentId })
    );

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([
          task({ id: "a", title: "Alpha", lexicalOrder: "a" }),
          task({ id: "b", title: "Beta", lexicalOrder: "b" }),
          task({ id: "c", title: "Gamma", lexicalOrder: "c" })
        ])),
        moveTask
      })
    );

    await screen.findByText("Alpha");
    const dataTransfer = dragTask("Gamma");
    const alphaRow = taskRow("Alpha");

    placePointer(alphaRow, 0);
    fireEvent.dragEnter(alphaRow, { dataTransfer });

    expect(alphaRow).toHaveClass("drag-before");

    fireEvent.drop(alphaRow, { dataTransfer });

    await waitFor(() => expect(moveTask).toHaveBeenCalledWith("c", null, null, null, "a", null));
  });

  it("indents and outdents tasks with keyboard shortcuts", async () => {
    const moveTask = vi.fn(async (id: string, projectId: string | null, sectionId: string | null, parentId: string | null): Promise<Task> =>
      task({ id, title: "Moved", projectId, sectionId, parentId })
    );

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([
          task({ id: "a", title: "Alpha", lexicalOrder: "a" }),
          task({ id: "b", title: "Beta", lexicalOrder: "b" }),
          task({ id: "parent", title: "Parent", lexicalOrder: "c", children: Object.freeze([
            task({ id: "child", title: "Child", parentId: "parent", lexicalOrder: "a" })
          ]) })
        ])),
        moveTask
      })
    );

    await screen.findByText("Beta");
    fireEvent.keyDown(taskRow("Beta"), { key: "ArrowRight", ctrlKey: true });

    await waitFor(() => expect(moveTask).toHaveBeenCalledWith("b", null, null, "a", null, null));

    fireEvent.keyDown(taskRow("Child"), { key: "ArrowLeft", ctrlKey: true });

    await waitFor(() => expect(moveTask).toHaveBeenCalledWith("child", null, null, null, null, "parent"));
  });

  it("outdents a nested task by dragging it left", async () => {
    const moveTask = vi.fn(async (id: string, projectId: string | null, sectionId: string | null, parentId: string | null): Promise<Task> =>
      task({ id, title: "Moved", projectId, sectionId, parentId })
    );

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([
          task({ id: "parent", title: "Parent", lexicalOrder: "a", children: Object.freeze([
            task({ id: "child", title: "Child", parentId: "parent", lexicalOrder: "a" })
          ]) })
        ])),
        moveTask
      })
    );

    await screen.findByText("Child");
    const dataTransfer = dragTask("Child");
    const childRow = taskRow("Child");

    placePointer(childRow, 0);
    Object.defineProperty(childRow, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        Object.freeze({
          x: 50,
          y: 0,
          top: 0,
          right: 450,
          bottom: 100,
          left: 50,
          width: 400,
          height: 100,
          toJSON: () => Object.freeze({})
        })
    });
    fireEvent.drop(childRow, { dataTransfer, clientX: -24 });

    await waitFor(() => expect(moveTask).toHaveBeenCalledWith("child", null, null, null, null, "parent"));
  });

  it("calls update and delete handlers", async () => {
    const updateTask = vi.fn(async (id: string, patch: Readonly<{ title?: string }>): Promise<Task> => task({ id, title: patch.title ?? "Plan MVP" }));
    const deleteTask = vi.fn(async () => undefined);

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([task({ id: "1", title: "Plan MVP" })])),
        updateTask,
        deleteTask
      })
    );

    await screen.findByText("Plan MVP");
    await userEvent.click(screen.getByRole("button", { name: "Edit task Plan MVP" }));
    expect(screen.getByLabelText("Edit Plan MVP")).toHaveFocus();
    await userEvent.clear(screen.getByLabelText("Edit Plan MVP"));
    await userEvent.type(screen.getByLabelText("Edit Plan MVP"), "Plan MVP carefully");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("1", { title: "Plan MVP carefully" }));

    await userEvent.click(screen.getByRole("button", { name: "Delete task Plan MVP" }));

    expect(window.confirm).toHaveBeenCalledWith('Delete task “Plan MVP” and its subtasks?');
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("1"));
  });

  it("does not delete when the confirmation is declined", async () => {
    const deleteTask = vi.fn(async () => undefined);
    vi.mocked(window.confirm).mockReturnValue(false);

    renderApp(Object.freeze({ ...baseApi(Object.freeze([task({ id: "1", title: "Plan MVP" })])), deleteTask }));
    await screen.findByText("Plan MVP");
    await userEvent.click(screen.getByRole("button", { name: "Delete task Plan MVP" }));

    expect(window.confirm).toHaveBeenCalled();
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it("skips delete confirmation when the preference is disabled", async () => {
    const deleteTask = vi.fn(async () => undefined);
    const api = Object.freeze({
      ...baseApi(Object.freeze([task({ id: "1", title: "Plan MVP" })])),
      getSettings: async () => Object.freeze({ confirmDelete: false, accessMode: "anonymous" as const, username: null }),
      deleteTask
    });

    renderApp(api);
    await screen.findByText("Plan MVP");
    await userEvent.click(screen.getByRole("button", { name: "Delete task Plan MVP" }));

    expect(window.confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("1"));
  });

  it("assigns a task to a project while editing", async () => {
    const updateTask = vi.fn(async (id: string, patch: Readonly<{ title?: string }>): Promise<Task> => task({ id, title: patch.title ?? "Plan MVP" }));
    const moveTask = vi.fn(async (id: string, projectId: string | null, sectionId: string | null, parentId: string | null): Promise<Task> =>
      task({ id, title: "Plan MVP", projectId, sectionId, parentId })
    );

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([task({ id: "1", title: "Plan MVP" })])),
        listProjects: async () => Object.freeze([project({ id: "project-1", title: "Roadmap" })]),
        updateTask,
        moveTask
      })
    );

    await screen.findByText("Plan MVP");
    await userEvent.click(screen.getByRole("button", { name: "Edit task Plan MVP" }));
    await userEvent.selectOptions(screen.getByLabelText("Move Plan MVP to"), "project:project-1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("1", { title: "Plan MVP" }));
    await waitFor(() => expect(moveTask).toHaveBeenCalledWith("1", "project-1", null, null, null, null));
  });

  it("updates and deletes inbox sections", async () => {
    const updateSection = vi.fn(async (id: string, title: string): Promise<Section> => section({ id, title }));
    const deleteSection = vi.fn(async () => undefined);

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([])),
        listSections: async () => Object.freeze([section({ id: "section-1", title: "Later" })]),
        updateSection,
        deleteSection
      })
    );

    await screen.findByRole("heading", { name: "Later" });
    await userEvent.click(screen.getByRole("button", { name: "Edit section Later" }));
    const editInput = screen.getAllByLabelText("Section title").at(-1);

    if (editInput === undefined) {
      throw new Error("Missing section edit input");
    }

    await userEvent.clear(editInput);
    await userEvent.type(editInput, "Soon");
    await userEvent.click(screen.getByRole("button", { name: "Save section" }));

    await waitFor(() => expect(updateSection).toHaveBeenCalledWith("section-1", "Soon"));

    await userEvent.click(await screen.findByRole("button", { name: "Delete section Soon" }));

    await waitFor(() => expect(deleteSection).toHaveBeenCalledWith("section-1"));
  });

  it("previews markdown for the current task list", async () => {
    renderApp(baseApi(Object.freeze([task({ id: "1", title: "Plan MVP", completed: true })])));

    await screen.findByText("Plan MVP");
    expect(screen.queryByText("P1")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Export$/ }));
    expect(await screen.findByRole("dialog", { name: "Export options" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Preview markdown" }));

    expect(await screen.findByRole("dialog", { name: "Markdown preview" })).toBeInTheDocument();
    expect(screen.getByText(/- \[x\] Plan MVP/)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Markdown preview" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Markdown preview" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Export options" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close export options" }));
  });

  it("previews JSON scoped to the currently open project with its complete task data", async () => {
    window.history.replaceState({}, "", "/?project=project-1");
    const projectTask = task({
      id: "project-task",
      title: "Project task",
      description: "Detailed project note",
      projectId: "project-1",
      sectionId: "section-1",
      dueDate: "2026-12-04",
      labels: Object.freeze(["planning"]),
      comments: Object.freeze([Object.freeze({ id: "project-comment", body: "Project comment", createdAt: "2026-10-22T10:00:00.000Z" })])
    });
    const api = Object.freeze({
      ...baseApi(Object.freeze([task({ id: "inbox-task", title: "Inbox only" }), projectTask])),
      listProjects: async () => Object.freeze([project({ id: "project-1", title: "Roadmap", description: "Roadmap details" })]),
      listSections: async () => Object.freeze([section({ id: "section-1", title: "Milestone", projectId: "project-1" })])
    });
    renderApp(api);

    await screen.findByText("Project task");
    await userEvent.click(screen.getByRole("button", { name: /^Export$/ }));
    expect(await screen.findByRole("dialog", { name: "Export options" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Preview JSON" }));
    const jsonDialog = await screen.findByRole("dialog", { name: "JSON preview" });
    const jsonText = jsonDialog.querySelector("pre")?.textContent;
    if (jsonText === null || jsonText === undefined) throw new Error("Missing scoped JSON preview");
    const exported = JSON.parse(jsonText) as { scope: { type: string; title: string }; project: { description: string; sections: ReadonlyArray<{ title: string }>; tasks: ReadonlyArray<{ description: string; dueDate: string; labels: ReadonlyArray<string>; comments: ReadonlyArray<{ body: string }> }> }; inbox: unknown; comments: ReadonlyArray<{ body: string }>; dates: ReadonlyArray<{ dueDate: string }> };
    expect(exported.scope).toEqual({ type: "project", id: "project-1", title: "Roadmap" });
    expect(exported.inbox).toBeNull();
    expect(exported.project).toMatchObject({ description: "Roadmap details", sections: [expect.objectContaining({ title: "Milestone" })], tasks: [expect.objectContaining({ description: "Detailed project note", dueDate: "2026-12-04", labels: ["planning"], comments: [expect.objectContaining({ body: "Project comment" })] })] });
    expect(exported.comments).toEqual([expect.objectContaining({ body: "Project comment" })]);
    expect(exported.dates).toEqual([expect.objectContaining({ dueDate: "2026-12-04" })]);
    expect(jsonText).not.toContain("Inbox only");
    fireEvent.keyDown(jsonDialog, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Export options" })).toBeInTheDocument();
  });

  it("exports a complete JSON document and previews all Markdown on the Export page", async () => {
    window.history.replaceState({}, "", "/export");
    const inboxTask = task({
      id: "inbox-task",
      title: "All tasks note",
      description: "Task description",
      dueDate: "2026-11-18",
      labels: Object.freeze(["important"]),
      comments: Object.freeze([Object.freeze({ id: "comment-1", body: "Task comment", createdAt: "2026-10-22T10:00:00.000Z" })])
    });
    const api = Object.freeze({
      ...baseApi(Object.freeze([inboxTask])),
      getInboxDescription: async () => "Inbox description",
      listProjects: async () => Object.freeze([project({ id: "project-1", title: "Roadmap", description: "Project description" })]),
      listSections: async () => Object.freeze([section({ id: "section-1", title: "Later", projectId: "project-1" })])
    });
    renderApp(api);

    expect(await screen.findByRole("heading", { name: "Export" })).toBeInTheDocument();
    const navigation = within(screen.getByLabelText("Navigation"));
    expect(navigation.queryByRole("button", { name: "Export all ZIP" })).not.toBeInTheDocument();
    expect(navigation.queryByRole("button", { name: "Export all markdown" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Preview all markdown" }));
    expect(await screen.findByRole("dialog", { name: "Markdown preview" })).toBeInTheDocument();
    expect(screen.getByText(/- \[ \] All tasks note/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    await userEvent.click(screen.getByRole("button", { name: "Preview all JSON" }));
    const jsonDialog = await screen.findByRole("dialog", { name: "JSON preview" });
    const jsonText = jsonDialog.querySelector("pre")?.textContent;
    if (jsonText === null || jsonText === undefined) throw new Error("Missing JSON preview content");
    const exported = JSON.parse(jsonText) as { inbox: { description: string; tasks: ReadonlyArray<{ description: string; dueDate: string; comments: ReadonlyArray<{ body: string }> }> }; projects: ReadonlyArray<{ description: string; sections: ReadonlyArray<{ title: string }> }>; sections: ReadonlyArray<{ title: string }>; dates: ReadonlyArray<{ dueDate: string }>; comments: ReadonlyArray<{ body: string }> };
    expect(exported.inbox.description).toBe("Inbox description");
    expect(exported.inbox.tasks[0]).toMatchObject({ description: "Task description", dueDate: "2026-11-18", comments: [expect.objectContaining({ body: "Task comment" })] });
    expect(exported.projects[0]).toMatchObject({ description: "Project description", sections: [expect.objectContaining({ title: "Later" })] });
    expect(exported.sections).toEqual([expect.objectContaining({ title: "Later" })]);
    expect(exported.dates).toEqual([expect.objectContaining({ dueDate: "2026-11-18" })]);
    expect(exported.comments).toEqual([expect.objectContaining({ body: "Task comment" })]);
  });
});

describe("ToolsPage", () => {
  it("runs database tool actions", async () => {
    const clearTable = vi.fn(async () => Object.freeze({ cleared: true }));
    const runQuery = vi.fn(async () => Object.freeze({ rows: Object.freeze([{ id: "1" }]) }));
    const api: ToolsApi = Object.freeze({
      listTables: async () => Object.freeze(["tasks"]),
      listRecords: async (table, limit) => Object.freeze({ table, limit, rows: [Object.freeze({ id: 1 })] }),
      clearTable,
      dropAllTables: async () => Object.freeze({ dropped: true }),
      migrate: async () => Object.freeze({ migrated: true }),
      clearAllTables: async () => Object.freeze({ cleared: true }),
      seed: async () => Object.freeze({ seeded: true }),
      runQuery
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToolsPage api={api} />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Database Tools")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View records" }));
    await waitFor(() => expect(screen.getByText(/"limit": "10"/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Tools" })).toHaveAttribute("href", "/tools");
    await userEvent.click(screen.getByRole("button", { name: "Clear selected table" }));

    await waitFor(() => expect(clearTable).toHaveBeenCalledWith("tasks"));

    await userEvent.clear(screen.getByLabelText("PostgreSQL query"));
    await userEvent.type(screen.getByLabelText("PostgreSQL query"), "SELECT 1;");
    await userEvent.click(screen.getByRole("button", { name: "Run query" }));

    await waitFor(() => expect(runQuery).toHaveBeenCalledWith("SELECT 1;"));
  });
});

describe("Dates and Labels task views", () => {
  afterEach(() => window.history.replaceState({}, "", "/"));

  it("shows dated tasks and their labels with links into the label filter", async () => {
    window.history.replaceState({}, "", "/dates");
    const datedParent = task({ id: "dated", title: "Dated note", dueDate: "2026-10-23", labels: Object.freeze(["work"]), children: Object.freeze([task({ id: "undated-child", title: "Undated child", parentId: "dated" })]) });
    renderApp(baseApi(Object.freeze([
      datedParent,
      task({ id: "plain", title: "No date" })
    ])));

    expect(await screen.findByRole("button", { name: "Dated note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undated child" })).toBeInTheDocument();
    expect(screen.queryByText("No date")).not.toBeInTheDocument();
    expect(screen.getByText("2026-10-23")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "work" })).toHaveAttribute("href", "/labels?label=work");
  });

  it("filters tasks by selected label across the complete task list", async () => {
    window.history.replaceState({}, "", "/labels?label=work");
    const labeledParent = task({ id: "match", title: "Project task", projectId: "p1", labels: Object.freeze(["work"]), children: Object.freeze([task({ id: "other-child", title: "Other label child", parentId: "match", labels: Object.freeze(["home"]) })]) });
    renderApp(baseApi(Object.freeze([
      labeledParent,
      task({ id: "other", title: "Other label", labels: Object.freeze(["home"]) })
    ])));

    expect(await screen.findByRole("button", { name: "Project task" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Other label child" })).toBeInTheDocument();
    expect(screen.queryByText("Other label")).not.toBeInTheDocument();
  });
});

describe("SearchPalette", () => {
  it("searches task descriptions and labels, and opens matching destinations", async () => {
    renderApp(baseApi(Object.freeze([
      task({ id: "search-task", title: "Prepare launch", description: "needle phrase in notes", labels: Object.freeze(["work"]) })
    ])));

    await userEvent.click(await screen.findByRole("button", { name: /Search/ }));
    const search = screen.getByRole("textbox", { name: "Search or type a command" });
    await userEvent.type(search, "needle");
    await userEvent.click(await screen.findByRole("button", { name: "Prepare launch" }));
    expect(await screen.findByRole("dialog", { name: "Task details: Prepare launch" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close task details" }));

    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true, bubbles: true });
    await userEvent.type(screen.getByRole("textbox", { name: "Search or type a command" }), "work");
    expect(await screen.findByRole("link", { name: /^work$/ })).toHaveAttribute("href", "/labels?label=work");
  });
});

describe("SettingsPage", () => {
  it("saves deletion and login settings", async () => {
    const updateSettings = vi.fn(async (settings: Parameters<ApplicationApi["updateSettings"]>[0]) =>
      Object.freeze({ confirmDelete: settings.confirmDelete, accessMode: settings.accessMode, username: settings.username })
    );
    const api = Object.freeze({ ...baseApi(Object.freeze([])), updateSettings });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsPage api={api} />
      </QueryClientProvider>
    );

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: /Ask for confirmation/ })).toBeChecked();
    await userEvent.click(screen.getByRole("checkbox", { name: /Ask for confirmation/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Require login and password/ }));
    await userEvent.type(screen.getByLabelText("Login"), "owner");
    await userEvent.type(screen.getByLabelText("Password"), "a-long-test-password");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(updateSettings.mock.calls[0]?.[0]).toEqual({
        confirmDelete: false,
        accessMode: "password",
        username: "owner",
        password: "a-long-test-password"
    });
  });
});

describe("createTaskApi", () => {
  it("moves tasks with the backend PUT contract", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ task: task({ id: "task-1", title: "Moved" }) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await createTaskApi("http://api.test").moveTask("task-1", "project-1", null, "parent-1", "before-1", "after-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/tasks/task-1/move",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentId: "parent-1",
          projectId: "project-1",
          sectionId: null,
          beforeId: "before-1",
          afterId: "after-1"
        })
      })
    );
  });

  it("updates projects and task patches with JSON requests", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("/projects/")
            ? { project: project({ id: "project-1", title: "Launch" }) }
            : { task: task({ id: "task-1", title: "Renamed" }) }
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    await createTaskApi("http://api.test").updateProject("project-1", Object.freeze({ title: "Launch" }));
    await createTaskApi("http://api.test").updateTask("task-1", Object.freeze({ title: "Renamed" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/projects/project-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Launch" })
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/tasks/task-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Renamed" })
      })
    );
  });
});
