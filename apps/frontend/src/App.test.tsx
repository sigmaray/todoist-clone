import { QueryClientProvider } from "@tanstack/react-query";
import type { Task, TaskNode } from "@todoist-clonse/domain";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, TaskApp, ToolsPage } from "./App";
import type { TaskApi, ToolsApi } from "./api";

const task = (values: Partial<TaskNode> & Pick<TaskNode, "id" | "title">): TaskNode =>
  Object.freeze({
    completed: false,
    priority: 4,
    parentId: null,
    lexicalOrder: "U",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    children: Object.freeze([]),
    ...values
  });

const renderApp = (api: TaskApi) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TaskApp api={api} />
    </QueryClientProvider>
  );

afterEach(() => {
  cleanup();
});

describe("TaskApp", () => {
  it("renders a task list", async () => {
    renderApp(
      Object.freeze({
        listTasks: async () => Object.freeze([task({ id: "1", title: "Plan MVP" })]),
        createTask: async (title): Promise<Task> => task({ id: "created", title }),
        patchTask: async (id, completed): Promise<Task> => task({ id, title: "Plan MVP", completed }),
        updateTaskTitle: async (id, title): Promise<Task> => task({ id, title }),
        deleteTask: async () => undefined
      })
    );

    expect(await screen.findByText("Plan MVP")).toBeInTheDocument();
  });

  it("calls the create handler when a task is submitted", async () => {
    const createTask = vi.fn(async (title: string): Promise<Task> => task({ id: "created", title }));

    renderApp(
      Object.freeze({
        listTasks: async () => Object.freeze([]),
        createTask,
        patchTask: async (id, completed): Promise<Task> => task({ id, title: "Created", completed }),
        updateTaskTitle: async (id, title): Promise<Task> => task({ id, title }),
        deleteTask: async () => undefined
      })
    );

    await userEvent.type(screen.getByLabelText("Task title"), "Write tests");
    await userEvent.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledWith("Write tests"));
  });

  it("calls update and delete handlers", async () => {
    const updateTaskTitle = vi.fn(async (id: string, title: string): Promise<Task> => task({ id, title }));
    const deleteTask = vi.fn(async () => undefined);

    renderApp(
      Object.freeze({
        listTasks: async () => Object.freeze([task({ id: "1", title: "Plan MVP" })]),
        createTask: async (title): Promise<Task> => task({ id: "created", title }),
        patchTask: async (id, completed): Promise<Task> => task({ id, title: "Plan MVP", completed }),
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
