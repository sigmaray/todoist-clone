import { QueryClientProvider } from "@tanstack/react-query";
import type { Project, Section, Task, TaskNode } from "@todoist-clone/domain";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, TaskApp, ToolsPage } from "./App";
import { createTaskApi } from "./api";
import type { TaskApi, ToolsApi } from "./api";

const task = (values: Partial<TaskNode> & Pick<TaskNode, "id" | "title">): TaskNode =>
  Object.freeze({
    completed: false,
    priority: 4,
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

const renderApp = (api: TaskApi) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TaskApp api={api} />
    </QueryClientProvider>
  );

const baseApi = (tasks: ReadonlyArray<TaskNode>): TaskApi =>
  Object.freeze({
    listTasks: async () => tasks,
    listProjects: async () => Object.freeze([]),
    createProject: async (title) =>
      Object.freeze({
        id: "project",
        title,
        lexicalOrder: "U",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }),
    updateProject: async (id, title) => project({ id, title }),
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
});

describe("TaskApp", () => {
  it("renders a task list", async () => {
    renderApp(baseApi(Object.freeze([task({ id: "1", title: "Plan MVP" })])));

    expect(await screen.findByText("Plan MVP")).toBeInTheDocument();
  });

  it("calls the create handler when a task is submitted", async () => {
    const createTask = vi.fn(async (title: string): Promise<Task> => task({ id: "created", title }));

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([])),
        createTask,
      })
    );

    await userEvent.type(screen.getByLabelText(/Task title/), "Write tests");
    await userEvent.click(screen.getByRole("button", { name: "Add task" }));

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

    await userEvent.type(screen.getByLabelText("Project title"), "Roadmap");
    await userEvent.click(screen.getByRole("button", { name: "Add project" }));
    await userEvent.click(await screen.findByRole("button", { name: "Roadmap" }));
    await userEvent.type(screen.getByLabelText(/Task title/), "Define milestones");
    await userEvent.click(screen.getByRole("button", { name: "Add task" }));

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

    await userEvent.type(screen.getByLabelText("Project title"), "Roadmap");
    await userEvent.click(screen.getByRole("button", { name: "Add project" }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith("Roadmap"));
    expect(await screen.findByRole("button", { name: "Roadmap" })).toBeInTheDocument();
  });

  it("updates and deletes projects from the sidebar", async () => {
    const updateProject = vi.fn(async (id: string, title: string): Promise<Project> => project({ id, title }));
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
    await userEvent.click(screen.getByRole("button", { name: "Edit project Roadmap" }));
    await screen.findByRole("button", { name: "Save project" });
    const editInput = screen.getAllByLabelText("Project title").at(0);

    if (editInput === undefined) {
      throw new Error("Missing project edit input");
    }

    await userEvent.clear(editInput);
    await userEvent.type(editInput, "Launch plan");
    await userEvent.click(screen.getByRole("button", { name: "Save project" }));

    await waitFor(() => expect(updateProject).toHaveBeenCalledWith("project-1", "Launch plan"));

    await userEvent.click(await screen.findByRole("button", { name: "Delete project Launch plan" }));

    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith("project-1"));
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

    await userEvent.type(screen.getByLabelText("Section title"), "Later");
    await userEvent.click(screen.getByRole("button", { name: "Add section" }));

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

    await userEvent.type(screen.getByLabelText("Section title"), "Someday");
    await userEvent.click(screen.getByRole("button", { name: "Add section" }));

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
    renderApp(baseApi(Object.freeze([task({ id: "1", title: "Plan MVP", completed: true, priority: 1 })])));

    await screen.findByText("Plan MVP");
    await userEvent.click(screen.getByRole("button", { name: "Preview markdown" }));

    expect(await screen.findByRole("dialog", { name: "Markdown preview" })).toBeInTheDocument();
    expect(screen.getByText(/- \[x\] Plan MVP \(P1\)/)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Markdown preview" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Markdown preview" })).not.toBeInTheDocument();
  });

  it("previews markdown for all tasks from the sidebar", async () => {
    renderApp(baseApi(Object.freeze([task({ id: "1", title: "All tasks note" })])));

    await screen.findByText("All tasks note");
    await userEvent.click(screen.getByRole("button", { name: "Preview all markdown" }));

    expect(await screen.findByRole("dialog", { name: "Markdown preview" })).toBeInTheDocument();
    expect(screen.getByText(/- \[ \] All tasks note/)).toBeInTheDocument();
  });
});

describe("ToolsPage", () => {
  it("runs database tool actions", async () => {
    const clearTable = vi.fn(async () => Object.freeze({ cleared: true }));
    const runQuery = vi.fn(async () => Object.freeze({ rows: Object.freeze([{ id: "1" }]) }));
    const api: ToolsApi = Object.freeze({
      listTables: async () => Object.freeze(["tasks"]),
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

    await createTaskApi("http://api.test").updateProject("project-1", "Launch");
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
