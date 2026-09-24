import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project, ProjectId, Section, SectionId, TaskNode } from "@todoist-clonse/domain";
import type { DragEvent, FormEvent, ReactElement } from "react";
import { useState } from "react";
import { createTaskApi, createToolsApi } from "./api";
import type { TaskApi, ToolsApi } from "./api";
import "./styles.css";

const taskQueryKey = Object.freeze(["tasks"]);
const projectQueryKey = Object.freeze(["projects"]);
const sectionQueryKey = Object.freeze(["sections"]);
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
    editPlacement: string;
    placementOptions: ReadonlyArray<Readonly<{ value: string; label: string }>>;
    setEditTitle: (title: string) => void;
    setEditPlacement: (placement: string) => void;
  }>,
  depth = 0
): ReactElement => (
  <ul className={depth === 0 ? "task-list" : "task-children"}>
    {tasks.map((task) => (
      <li key={task.id} className="task-item">
        <div
          className="task-row"
          data-task-id={task.id}
          draggable
          onDragStart={(event) => event.dataTransfer.setData("text/task-id", task.id)}
          style={{ paddingLeft: `${depth * 1.25}rem` }}
        >
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
              <select
                aria-label={`Move ${task.title} to`}
                value={actions.editPlacement}
                onChange={(event) => actions.setEditPlacement(event.target.value)}
              >
                {actions.placementOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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

const inboxPlacement = "inbox";
const projectPlacement = (id: ProjectId) => `project:${id}`;
const sectionPlacement = (id: SectionId) => `section:${id}`;

const taskPlacement = (task: TaskNode) =>
  task.sectionId !== null ? sectionPlacement(task.sectionId) : task.projectId !== null ? projectPlacement(task.projectId) : inboxPlacement;

const parsePlacement = (placement: string): Readonly<{ projectId: ProjectId | null; sectionId: SectionId | null }> => {
  if (placement.startsWith("project:")) {
    return Object.freeze({ projectId: placement.slice("project:".length), sectionId: null });
  }

  if (placement.startsWith("section:")) {
    return Object.freeze({ projectId: null, sectionId: placement.slice("section:".length) });
  }

  return Object.freeze({ projectId: null, sectionId: null });
};

const createPlacementOptions = (
  projects: ReadonlyArray<Project>,
  sections: ReadonlyArray<Section>
): ReadonlyArray<Readonly<{ value: string; label: string }>> =>
  Object.freeze([
    Object.freeze({ value: inboxPlacement, label: "Inbox" }),
    ...sections
      .filter((section) => section.projectId === null)
      .map((section) => Object.freeze({ value: sectionPlacement(section.id), label: `Inbox / ${section.title}` })),
    ...projects.map((project) => Object.freeze({ value: projectPlacement(project.id), label: `My Projects / ${project.title}` }))
  ]);

const appendById = <TItem extends Readonly<{ id: string }>>(
  items: ReadonlyArray<TItem> | undefined,
  item: TItem
): ReadonlyArray<TItem> =>
  Object.freeze([...(items ?? Object.freeze([])).filter((existing) => existing.id !== item.id), item]);

export const TaskApp = ({ api }: Readonly<{ api: TaskApi }>) => {
  const [title, setTitle] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [targetProjectId, setTargetProjectId] = useState<ProjectId | null>(null);
  const [targetSectionId, setTargetSectionId] = useState<SectionId | null>(null);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPlacement, setEditPlacement] = useState(inboxPlacement);
  const queryClient = useQueryClient();

  const tasks = useQuery({
    queryKey: taskQueryKey,
    queryFn: api.listTasks
  });

  const projects = useQuery({
    queryKey: projectQueryKey,
    queryFn: api.listProjects
  });

  const sections = useQuery({
    queryKey: sectionQueryKey,
    queryFn: api.listSections
  });

  const createMutation = useMutation({
    mutationFn: (nextTitle: string) => api.createTask(nextTitle, targetProjectId, targetSectionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskQueryKey });
    }
  });

  const createProjectMutation = useMutation({
    mutationFn: (nextTitle: string) => api.createProject(nextTitle),
    onSuccess: (project) => {
      setProjectTitle("");
      queryClient.setQueryData(projectQueryKey, (current: ReadonlyArray<Project> | undefined) => appendById(current, project));
    }
  });

  const createSectionMutation = useMutation({
    mutationFn: (nextTitle: string) => api.createSection(nextTitle, null),
    onSuccess: (section) => {
      setSectionTitle("");
      queryClient.setQueryData(sectionQueryKey, (current: ReadonlyArray<Section> | undefined) => appendById(current, section));
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
    mutationFn: async (task: TaskNode) => {
      const placement = parsePlacement(editPlacement);
      const titleTask = await api.updateTaskTitle(task.id, editTitle.trim());

      return taskPlacement(task) === editPlacement
        ? titleTask
        : api.moveTask(task.id, placement.projectId, placement.sectionId);
    },
    onSuccess: async () => {
      setEditTaskId(null);
      setEditTitle("");
      setEditPlacement(inboxPlacement);
      await queryClient.invalidateQueries({ queryKey: taskQueryKey });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (task: TaskNode) => api.deleteTask(task.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskQueryKey });
    }
  });

  const moveMutation = useMutation({
    mutationFn: (placement: Readonly<{ taskId: string; projectId: ProjectId | null; sectionId: SectionId | null }>) =>
      api.moveTask(placement.taskId, placement.projectId, placement.sectionId),
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

  const submitProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = projectTitle.trim();

    if (trimmed.length > 0) {
      createProjectMutation.mutate(trimmed);
    }
  };

  const submitSection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = sectionTitle.trim();

    if (trimmed.length > 0) {
      createSectionMutation.mutate(trimmed);
    }
  };

  const moveDroppedTask = (projectId: ProjectId | null, sectionId: SectionId | null) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/task-id");

    if (taskId.length > 0) {
      moveMutation.mutate(Object.freeze({ taskId, projectId, sectionId }));
    }
  };

  const allowDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
  };

  const startEditing = (task: TaskNode) => {
    setEditTaskId(task.id);
    setEditTitle(task.title);
    setEditPlacement(taskPlacement(task));
  };

  const submitEdit = (task: TaskNode) => {
    if (editTitle.trim().length === 0) {
      return;
    }

    editMutation.mutate(task);
  };

  const allTasks = tasks.data ?? Object.freeze([]);
  const allProjects = projects.data ?? Object.freeze([]);
  const allSections = sections.data ?? Object.freeze([]);
  const inboxSections = allSections.filter((section) => section.projectId === null);
  const inboxRootTasks = allTasks.filter((task) => task.projectId === null && task.sectionId === null);

  const taskActions = Object.freeze({
    toggleTask: toggleMutation.mutate,
    startEditing,
    deleteTask: deleteMutation.mutate,
    submitEdit,
    cancelEdit: () => {
      setEditTaskId(null);
      setEditTitle("");
      setEditPlacement(inboxPlacement);
    },
    editTaskId,
    editTitle,
    editPlacement,
    placementOptions: createPlacementOptions(allProjects, allSections),
    setEditTitle,
    setEditPlacement
  });

  const taskTargetLabel =
    targetSectionId !== null
      ? inboxSections.find((section) => section.id === targetSectionId)?.title ?? "selected section"
      : targetProjectId !== null
        ? allProjects.find((project) => project.id === targetProjectId)?.title ?? "selected project"
        : "Inbox";

  return (
    <main className="shell app-layout">
      <aside className="sidebar" aria-label="Navigation">
        <button
          type="button"
          className="nav-button"
          onClick={() => {
            setTargetProjectId(null);
            setTargetSectionId(null);
          }}
          onDragOver={allowDrop}
          onDrop={moveDroppedTask(null, null)}
        >
          Inbox
        </button>
        <div className="sidebar-group">
          <h2>My Projects</h2>
          {allProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              className="nav-button"
              onClick={() => {
                setTargetProjectId(project.id);
                setTargetSectionId(null);
              }}
              onDragOver={allowDrop}
              onDrop={moveDroppedTask(project.id, null)}
            >
              {project.title}
            </button>
          ))}
        </div>
        <form className="compact-form" onSubmit={submitProject}>
          <label htmlFor="project-title">Project title</label>
          <input id="project-title" value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} />
          <button type="submit">Add project</button>
        </form>
      </aside>

      <section className="workspace" aria-label="Task manager">
        <header className="header">
          <p className="eyebrow">Self-hosted MVP</p>
          <h1>{targetProjectId === null ? "Inbox" : taskTargetLabel}</h1>
        </header>

        <form className="task-form" onSubmit={submit}>
          <label className="input-label" htmlFor="task-title">
            Task title for {taskTargetLabel}
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
        {targetProjectId === null ? (
          <div className="board">
            <section className="drop-zone" onDragOver={allowDrop} onDrop={moveDroppedTask(null, null)} aria-label="Inbox tasks">
              <h2>Inbox</h2>
              {inboxRootTasks.length > 0 ? renderTaskNodes(inboxRootTasks, taskActions) : <p className="empty">No inbox tasks yet.</p>}
            </section>
            <form className="compact-form inline" onSubmit={submitSection}>
              <label htmlFor="section-title">Section title</label>
              <input id="section-title" value={sectionTitle} onChange={(event) => setSectionTitle(event.target.value)} />
              <button type="submit">Add section</button>
            </form>
            {inboxSections.map((section) => {
              const sectionTasks = allTasks.filter((task) => task.projectId === null && task.sectionId === section.id);

              return (
                <section
                  key={section.id}
                  className="drop-zone"
                  onDragOver={allowDrop}
                  onDrop={moveDroppedTask(null, section.id)}
                  aria-label={`Section ${section.title}`}
                >
                  <h2>{section.title}</h2>
                  {sectionTasks.length > 0 ? renderTaskNodes(sectionTasks, taskActions) : <p className="empty">Drop inbox tasks here.</p>}
                </section>
              );
            })}
          </div>
        ) : (
          <section className="drop-zone" onDragOver={allowDrop} onDrop={moveDroppedTask(targetProjectId, null)} aria-label={`${taskTargetLabel} tasks`}>
            {allTasks.filter((task) => task.projectId === targetProjectId && task.sectionId === null).length > 0 ? (
              renderTaskNodes(
                allTasks.filter((task) => task.projectId === targetProjectId && task.sectionId === null),
                taskActions
              )
            ) : (
              <p className="empty">No project tasks yet.</p>
            )}
          </section>
        )}
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
