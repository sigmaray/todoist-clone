import { QueryClientProvider } from "@tanstack/react-query";
import type { Project, Section, Task, TaskNode } from "@todoist-clonse/domain";
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
    updateTaskTitle: async (id, title): Promise<Task> => task({ id, title }),
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

    await waitFor(() => expect(moveTask).toHaveBeenCalledWith("task-1", null, "section-1", null));
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

    await waitFor(() => expect(moveTask).toHaveBeenCalledWith("task-1", null, null, null));
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
    fireEvent.drop(screen.getByText("Parent task").closest(".task-row") ?? screen.getByText("Parent task"), { dataTransfer });

    await waitFor(() => expect(moveTask).toHaveBeenCalledWith("child", null, null, "parent"));
  });

  it("calls update and delete handlers", async () => {
    const updateTaskTitle = vi.fn(async (id: string, title: string): Promise<Task> => task({ id, title }));
    const deleteTask = vi.fn(async () => undefined);

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([task({ id: "1", title: "Plan MVP" })])),
        updateTaskTitle,
        deleteTask
      })
    );

    await screen.findByText("Plan MVP");
    await userEvent.click(screen.getByRole("button", { name: "Edit task Plan MVP" }));
    await userEvent.clear(screen.getByLabelText("Edit Plan MVP"));
    await userEvent.type(screen.getByLabelText("Edit Plan MVP"), "Plan MVP carefully");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateTaskTitle).toHaveBeenCalledWith("1", "Plan MVP carefully"));

    await userEvent.click(screen.getByRole("button", { name: "Delete task Plan MVP" }));

    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("1"));
  });

  it("assigns a task to a project while editing", async () => {
    const updateTaskTitle = vi.fn(async (id: string, title: string): Promise<Task> => task({ id, title }));
    const moveTask = vi.fn(async (id: string, projectId: string | null, sectionId: string | null, parentId: string | null): Promise<Task> =>
      task({ id, title: "Plan MVP", projectId, sectionId, parentId })
    );

    renderApp(
      Object.freeze({
        ...baseApi(Object.freeze([task({ id: "1", title: "Plan MVP" })])),
        listProjects: async () => Object.freeze([project({ id: "project-1", title: "Roadmap" })]),
        updateTaskTitle,
        moveTask
      })
    );

    await screen.findByText("Plan MVP");
    await userEvent.click(screen.getByRole("button", { name: "Edit task Plan MVP" }));
    await userEvent.selectOptions(screen.getByLabelText("Move Plan MVP to"), "project:project-1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateTaskTitle).toHaveBeenCalledWith("1", "Plan MVP"));
    await waitFor(() => expect(moveTask).toHaveBeenCalledWith("1", "project-1", null, null));
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

    await createTaskApi("http://api.test").moveTask("task-1", "project-1", null, "parent-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/tasks/task-1/move",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentId: "parent-1",
          projectId: "project-1",
          sectionId: null,
          beforeId: null,
          afterId: null
        })
      })
    );
  });
});
