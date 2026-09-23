import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskNode } from "@todoist-clonse/domain";
import type { FormEvent, ReactElement } from "react";
import { useState } from "react";
import { createTaskApi, createToolsApi } from "./api";
import type { TaskApi, ToolsApi } from "./api";
import "./styles.css";

const taskQueryKey = Object.freeze(["tasks"]);
const tablesQueryKey = Object.freeze(["tools", "tables"]);
const toolsEnabled = import.meta.env.DEV || import.meta.env.MODE === "test";

const renderTaskNodes = (
  tasks: ReadonlyArray<TaskNode>,
  actions: Readonly<{
    toggleTask: (task: TaskNode) => void;
    startEditing: (task: TaskNode) => void;
    deleteTask: (task: TaskNode) => void;
    submitEdit: (task: TaskNode) => void;
    cancelEdit: () => void;
    editTaskId: string | null;
    editTitle: string;
    setEditTitle: (title: string) => void;
  }>,
  depth = 0
): ReactElement => (
  <ul className={depth === 0 ? "task-list" : "task-children"}>
    {tasks.map((task) => (
      <li key={task.id} className="task-item">
        <div className="task-row" style={{ paddingLeft: `${depth * 1.25}rem` }}>
          <input
            aria-label={`Complete ${task.title}`}
            checked={task.completed}
            type="checkbox"
            onChange={() => actions.toggleTask(task)}
          />
          {actions.editTaskId === task.id ? (
            <form
              className="edit-form"
              onSubmit={(event) => {
                event.preventDefault();
                actions.submitEdit(task);
              }}
            >
              <input
                aria-label={`Edit ${task.title}`}
                value={actions.editTitle}
                onChange={(event) => actions.setEditTitle(event.target.value)}
              />
              <button type="submit">Save</button>
              <button type="button" onClick={actions.cancelEdit}>
                Cancel
              </button>
            </form>
          ) : (
            <span className={task.completed ? "task-title completed" : "task-title"}>{task.title}</span>
          )}
          <span className="priority">P{task.priority}</span>
          <button type="button" className="task-action" aria-label={`Edit task ${task.title}`} onClick={() => actions.startEditing(task)}>
            Edit
          </button>
          <button type="button" className="task-action danger" aria-label={`Delete task ${task.title}`} onClick={() => actions.deleteTask(task)}>
            Delete
          </button>
        </div>
        {task.children.length > 0 ? renderTaskNodes(task.children, actions, depth + 1) : null}
      </li>
    ))}
  </ul>
);

export const TaskApp = ({ api }: Readonly<{ api: TaskApi }>) => {
  const [title, setTitle] = useState("");
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const queryClient = useQueryClient();

  const tasks = useQuery({
    queryKey: taskQueryKey,
    queryFn: api.listTasks
  });

  const createMutation = useMutation({
    mutationFn: (nextTitle: string) => api.createTask(nextTitle),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskQueryKey });
    }
  });

  const toggleMutation = useMutation({
    mutationFn: (task: TaskNode) => api.patchTask(task.id, !task.completed),
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: taskQueryKey });
      const previousTasks = queryClient.getQueryData<ReadonlyArray<TaskNode>>(taskQueryKey);

      const toggleNodes = (nodes: ReadonlyArray<TaskNode>): ReadonlyArray<TaskNode> =>
        Object.freeze(
          nodes.map((node) =>
            Object.freeze({
              ...node,
              completed: node.id === task.id ? !node.completed : node.completed,
              children: toggleNodes(node.children)
            })
          )
        );

      queryClient.setQueryData(taskQueryKey, toggleNodes(previousTasks ?? Object.freeze([])));

      return Object.freeze({ previousTasks });
    },
    onError: (_error, _task, context) => {
      queryClient.setQueryData(taskQueryKey, context?.previousTasks);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: taskQueryKey });
    }
  });

  const editMutation = useMutation({
    mutationFn: (task: TaskNode) => api.updateTaskTitle(task.id, editTitle.trim()),
    onSuccess: async () => {
      setEditTaskId(null);
      setEditTitle("");
      await queryClient.invalidateQueries({ queryKey: taskQueryKey });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (task: TaskNode) => api.deleteTask(task.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskQueryKey });
    }
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = title.trim();

    if (trimmed.length === 0) {
      return;
    }

    createMutation.mutate(trimmed);
    setTitle("");
  };

  const startEditing = (task: TaskNode) => {
    setEditTaskId(task.id);
    setEditTitle(task.title);
  };

  const submitEdit = (task: TaskNode) => {
    if (editTitle.trim().length === 0) {
      return;
    }

    editMutation.mutate(task);
  };

  const taskActions = Object.freeze({
    toggleTask: toggleMutation.mutate,
    startEditing,
    deleteTask: deleteMutation.mutate,
    submitEdit,
    cancelEdit: () => {
      setEditTaskId(null);
      setEditTitle("");
    },
    editTaskId,
    editTitle,
    setEditTitle
  });

  return (
    <main className="shell">
      <section className="workspace" aria-label="Task manager">
        <header className="header">
          <p className="eyebrow">Self-hosted MVP</p>
          <h1>Today</h1>
        </header>

        <form className="task-form" onSubmit={submit}>
          <label className="input-label" htmlFor="task-title">
            Task title
          </label>
          <div className="input-row">
            <input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Add a task"
            />
            <button type="submit" disabled={createMutation.isPending}>
              Add task
            </button>
          </div>
        </form>

        {tasks.isLoading ? <p className="muted">Loading tasks...</p> : null}
        {tasks.isError ? <p className="error">Unable to load tasks.</p> : null}
        {tasks.data !== undefined && tasks.data.length > 0 ? renderTaskNodes(tasks.data, taskActions) : null}
        {tasks.data !== undefined && tasks.data.length === 0 ? <p className="empty">No tasks yet.</p> : null}
      </section>
    </main>
  );
};

export const ToolsPage = ({ api }: Readonly<{ api: ToolsApi }>) => {
  const [selectedTable, setSelectedTable] = useState("");
  const [sql, setSql] = useState("SELECT * FROM tasks ORDER BY lexical_order;");
  const [result, setResult] = useState<unknown>(Object.freeze({ ready: true }));
  const queryClient = useQueryClient();

  const tables = useQuery({
    queryKey: tablesQueryKey,
    queryFn: api.listTables
  });

  const runAction = (action: () => Promise<unknown>) => async () => {
    const data = await action();

    setResult(data);
    await queryClient.invalidateQueries({ queryKey: tablesQueryKey });
  };

  const clearTable = useMutation({
    mutationFn: (table: string) => api.clearTable(table),
    onSuccess: async (data) => {
      setResult(data);
      await queryClient.invalidateQueries({ queryKey: tablesQueryKey });
    }
  });

  const runQuery = useMutation({
    mutationFn: (nextSql: string) => api.runQuery(nextSql),
    onSuccess: (data) => setResult(data)
  });

  if (!toolsEnabled) {
    return (
      <main className="shell">
        <section className="workspace" aria-label="Developer tools disabled">
          <h1>Not found</h1>
        </section>
      </main>
    );
  }

  const tableOptions = tables.data ?? Object.freeze([]);
  const tableValue = selectedTable || tableOptions[0] || "";

  return (
    <main className="shell">
      <section className="workspace tools-panel" aria-label="Database tools">
        <header className="header">
          <p className="eyebrow">Development tools</p>
          <h1>Database Tools</h1>
        </header>

        <div className="tools-grid">
          <label className="input-label" htmlFor="table-select">
            Table
          </label>
          <select id="table-select" value={tableValue} onChange={(event) => setSelectedTable(event.target.value)}>
            {tableOptions.map((table) => (
              <option key={table} value={table}>
                {table}
              </option>
            ))}
          </select>
          <button type="button" disabled={tableValue.length === 0} onClick={() => clearTable.mutate(tableValue)}>
            Clear selected table
          </button>
          <button type="button" onClick={runAction(api.dropAllTables)}>
            Drop all tables
          </button>
          <button type="button" onClick={runAction(api.migrate)}>
            Run migrations
          </button>
          <button type="button" onClick={runAction(api.clearAllTables)}>
            Clear all tables
          </button>
          <button type="button" onClick={runAction(api.seed)}>
            Seed test data
          </button>
        </div>

        <form
          className="sql-form"
          onSubmit={(event) => {
            event.preventDefault();
            runQuery.mutate(sql);
          }}
        >
          <label className="input-label" htmlFor="sql-query">
            PostgreSQL query
          </label>
          <textarea id="sql-query" value={sql} onChange={(event) => setSql(event.target.value)} />
          <button type="submit">Run query</button>
        </form>

        <pre className="query-result">{JSON.stringify(result, null, 2)}</pre>
      </section>
    </main>
  );
};

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

const renderRoute = () => {
  if (window.location.pathname.startsWith("/tools")) {
    return <ToolsPage api={createToolsApi()} />;
  }

  return <TaskApp api={createTaskApi()} />;
};

export const App = () => <QueryClientProvider client={createQueryClient()}>{renderRoute()}</QueryClientProvider>;
