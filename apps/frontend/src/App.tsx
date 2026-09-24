import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { renderTaskMarkdownDocument } from "@todoist-clonse/domain";
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
    startSubtask: (task: TaskNode) => void;
    submitSubtask: (task: TaskNode) => void;
    cancelSubtask: () => void;
    moveTaskIntoTask: (task: TaskNode) => (event: DragEvent<HTMLElement>) => void;
    markDragTarget: (taskId: string | null) => void;
    finishDragging: () => void;
    startDragging: (task: TaskNode) => (event: DragEvent<HTMLElement>) => void;
    submitEdit: (task: TaskNode) => void;
    cancelEdit: () => void;
    editTaskId: string | null;
    editTitle: string;
    editPlacement: string;
    subtaskParentId: string | null;
    subtaskTitle: string;
    draggingTaskId: string | null;
    dragTargetTaskId: string | null;
    placementOptions: ReadonlyArray<Readonly<{ value: string; label: string }>>;
    setEditTitle: (title: string) => void;
    setEditPlacement: (placement: string) => void;
    setSubtaskTitle: (title: string) => void;
  }>,
  depth = 0
): ReactElement => (
  <ul className={depth === 0 ? "task-list" : "task-children"}>
    {tasks.map((task) => (
      <li key={task.id} className="task-item">
        <div
          className={[
            "task-row",
            actions.draggingTaskId === task.id ? "dragging" : "",
            actions.dragTargetTaskId === task.id ? "drag-target" : ""
          ].filter(Boolean).join(" ")}
          data-task-id={task.id}
          draggable
          onDragStart={actions.startDragging(task)}
          onDragEnd={actions.finishDragging}
          onDragEnter={() => actions.markDragTarget(task.id)}
          onDragLeave={() => actions.markDragTarget(null)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={actions.moveTaskIntoTask(task)}
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
              className="edit-panel"
              onSubmit={(event) => {
                event.preventDefault();
                actions.submitEdit(task);
              }}
            >
              <label>
                Title
                <input
                  aria-label={`Edit ${task.title}`}
                  value={actions.editTitle}
                  onChange={(event) => actions.setEditTitle(event.target.value)}
                />
              </label>
              <label>
                Location
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
              </label>
              <div className="edit-panel-actions">
                <button type="submit">Save</button>
                <button type="button" onClick={actions.cancelEdit}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <span className={task.completed ? "task-title completed" : "task-title"}>{task.title}</span>
          )}
          <span className="priority">P{task.priority}</span>
          <button type="button" className="task-action" aria-label={`Edit task ${task.title}`} onClick={() => actions.startEditing(task)}>
            Edit
          </button>
          <button type="button" className="task-action" aria-label={`Add subtask to ${task.title}`} onClick={() => actions.startSubtask(task)}>
            Subtask
          </button>
          <button type="button" className="task-action danger" aria-label={`Delete task ${task.title}`} onClick={() => actions.deleteTask(task)}>
            Delete
          </button>
        </div>
        {actions.subtaskParentId === task.id ? (
          <form
            className="subtask-form"
            style={{ marginLeft: `${depth * 1.25 + 2.1}rem` }}
            onSubmit={(event) => {
              event.preventDefault();
              actions.submitSubtask(task);
            }}
          >
            <label htmlFor={`subtask-${task.id}`}>Subtask for {task.title}</label>
            <input
              id={`subtask-${task.id}`}
              value={actions.subtaskTitle}
              onChange={(event) => actions.setSubtaskTitle(event.target.value)}
              placeholder="Add a subtask"
            />
            <button type="submit">Add subtask</button>
            <button type="button" onClick={actions.cancelSubtask}>
              Cancel
            </button>
          </form>
        ) : null}
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

const removeById = <TItem extends Readonly<{ id: string }>>(
  items: ReadonlyArray<TItem> | undefined,
  id: string
): ReadonlyArray<TItem> =>
  Object.freeze((items ?? Object.freeze([])).filter((existing) => existing.id !== id));

const findTaskNode = (tasks: ReadonlyArray<TaskNode>, id: string): TaskNode | null =>
  tasks.reduce<TaskNode | null>(
    (found, task) => found ?? (task.id === id ? task : findTaskNode(task.children, id)),
    null
  );

const hasDescendant = (task: TaskNode, id: string): boolean =>
  task.children.some((child) => child.id === id || hasDescendant(child, id));

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "tasks";

const currentMarkdown = (
  title: string,
  inboxRootTasks: ReadonlyArray<TaskNode>,
  inboxSections: ReadonlyArray<Section>,
  allTasks: ReadonlyArray<TaskNode>,
  targetProjectId: ProjectId | null
) => {
  if (targetProjectId !== null) {
    return renderTaskMarkdownDocument(
      title,
      allTasks.filter((task) => task.projectId === targetProjectId && task.sectionId === null)
    );
  }

  return [
    renderTaskMarkdownDocument("Inbox", inboxRootTasks),
    ...inboxSections.map((section) =>
      renderTaskMarkdownDocument(
        `Inbox / ${section.title}`,
        allTasks.filter((task) => task.projectId === null && task.sectionId === section.id)
      )
    )
  ].join("\n");
};

const allMarkdownFiles = (
  projects: ReadonlyArray<Project>,
  sections: ReadonlyArray<Section>,
  tasks: ReadonlyArray<TaskNode>
): ReadonlyArray<Readonly<{ name: string; content: string }>> =>
  Object.freeze([
    Object.freeze({
      name: "inbox.md",
      content: renderTaskMarkdownDocument(
        "Inbox",
        tasks.filter((task) => task.projectId === null && task.sectionId === null)
      )
    }),
    ...sections
      .filter((section) => section.projectId === null)
      .map((section) =>
        Object.freeze({
          name: `inbox-${slug(section.title)}.md`,
          content: renderTaskMarkdownDocument(
            `Inbox / ${section.title}`,
            tasks.filter((task) => task.projectId === null && task.sectionId === section.id)
          )
        })
      ),
    ...projects.map((project) =>
      Object.freeze({
        name: `project-${slug(project.title)}.md`,
        content: renderTaskMarkdownDocument(
          project.title,
          tasks.filter((task) => task.projectId === project.id && task.sectionId === null)
        )
      })
    )
  ]);

const copyText = async (text: string) => {
  if (navigator.clipboard !== undefined) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
};

const crcTable = Object.freeze(
  Array.from({ length: 256 }, (_, index) => {
    const step = (value: number, bit: number): number =>
      bit === 8 ? value >>> 0 : step((value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1, bit + 1);

    return step(index, 0);
  })
);

const crc32 = (data: Uint8Array) =>
  (data.reduce((crc, byte) => crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;

const uint16 = (value: number) => Object.freeze([value & 0xff, (value >>> 8) & 0xff]);
const uint32 = (value: number) => Object.freeze([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);

const concatBytes = (parts: ReadonlyArray<Uint8Array>) => {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(size);
  parts.reduce((offset, part) => {
    output.set(part, offset);
    return offset + part.length;
  }, 0);

  return output;
};

type ZipBuildState = Readonly<{
  offset: number;
  local: ReadonlyArray<Uint8Array>;
  central: ReadonlyArray<Uint8Array>;
}>;

const createZipBlob = (files: ReadonlyArray<Readonly<{ name: string; content: string }>>) => {
  const encoder = new TextEncoder();
  const initialZipState: ZipBuildState = Object.freeze({
    offset: 0,
    local: Object.freeze([] as ReadonlyArray<Uint8Array>),
    central: Object.freeze([] as ReadonlyArray<Uint8Array>)
  });
  const entries = files.reduce<ZipBuildState>(
    (state, file) => {
      const name = encoder.encode(file.name);
      const content = encoder.encode(file.content);
      const crc = crc32(content);
      const localHeader = new Uint8Array([
        ...uint32(0x04034b50),
        ...uint16(20),
        ...uint16(0),
        ...uint16(0),
        ...uint16(0),
        ...uint16(0),
        ...uint32(crc),
        ...uint32(content.length),
        ...uint32(content.length),
        ...uint16(name.length),
        ...uint16(0)
      ]);
      const centralHeader = new Uint8Array([
        ...uint32(0x02014b50),
        ...uint16(20),
        ...uint16(20),
        ...uint16(0),
        ...uint16(0),
        ...uint16(0),
        ...uint16(0),
        ...uint32(crc),
        ...uint32(content.length),
        ...uint32(content.length),
        ...uint16(name.length),
        ...uint16(0),
        ...uint16(0),
        ...uint16(0),
        ...uint16(0),
        ...uint32(0),
        ...uint32(state.offset)
      ]);
      const local = concatBytes([localHeader, name, content]);
      const central = concatBytes([centralHeader, name]);

      return Object.freeze({
        offset: state.offset + local.length,
        local: Object.freeze([...state.local, local]),
        central: Object.freeze([...state.central, central])
      });
    },
    initialZipState
  );
  const centralBytes = concatBytes(entries.central);
  const end = new Uint8Array([
    ...uint32(0x06054b50),
    ...uint16(0),
    ...uint16(0),
    ...uint16(files.length),
    ...uint16(files.length),
    ...uint32(centralBytes.length),
    ...uint32(entries.offset),
    ...uint16(0)
  ]);

  return new Blob([concatBytes([...entries.local, centralBytes, end])], { type: "application/zip" });
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const TaskApp = ({ api }: Readonly<{ api: TaskApi }>) => {
  const [title, setTitle] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [editSectionId, setEditSectionId] = useState<SectionId | null>(null);
  const [editSectionTitle, setEditSectionTitle] = useState("");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskParentId, setSubtaskParentId] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragTargetTaskId, setDragTargetTaskId] = useState<string | null>(null);
  const [targetProjectId, setTargetProjectId] = useState<ProjectId | null>(null);
  const [targetSectionId, setTargetSectionId] = useState<SectionId | null>(null);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPlacement, setEditPlacement] = useState(inboxPlacement);
  const [markdownModal, setMarkdownModal] = useState<Readonly<{ title: string; markdown: string }> | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
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
    mutationFn: (nextTitle: string) => api.createTask(nextTitle, targetProjectId, targetSectionId, null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskQueryKey });
    }
  });

  const createSubtaskMutation = useMutation({
    mutationFn: (subtask: Readonly<{ title: string; parent: TaskNode }>) =>
      api.createTask(subtask.title, subtask.parent.projectId, subtask.parent.sectionId, subtask.parent.id),
    onSuccess: async () => {
      setSubtaskTitle("");
      setSubtaskParentId(null);
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

  const updateSectionMutation = useMutation({
    mutationFn: (section: Readonly<{ id: SectionId; title: string }>) => api.updateSection(section.id, section.title),
    onSuccess: (section) => {
      setEditSectionId(null);
      setEditSectionTitle("");
      queryClient.setQueryData(sectionQueryKey, (current: ReadonlyArray<Section> | undefined) => appendById(current, section));
    }
  });

  const deleteSectionMutation = useMutation({
    mutationFn: (section: Section) => api.deleteSection(section.id).then(() => section),
    onSuccess: async (section) => {
      queryClient.setQueryData(sectionQueryKey, (current: ReadonlyArray<Section> | undefined) => removeById(current, section.id));
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
    mutationFn: async (task: TaskNode) => {
      const placement = parsePlacement(editPlacement);
      const titleTask = await api.updateTaskTitle(task.id, editTitle.trim());

      return taskPlacement(task) === editPlacement
        ? titleTask
        : api.moveTask(task.id, placement.projectId, placement.sectionId, null);
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
    mutationFn: (placement: Readonly<{ taskId: string; projectId: ProjectId | null; sectionId: SectionId | null; parentId: string | null }>) =>
      api.moveTask(placement.taskId, placement.projectId, placement.sectionId, placement.parentId),
    onSuccess: async () => {
      setDraggingTaskId(null);
      setDragTargetTaskId(null);
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

  const submitSectionEdit = (section: Section) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = editSectionTitle.trim();

    if (trimmed.length > 0) {
      updateSectionMutation.mutate(Object.freeze({ id: section.id, title: trimmed }));
    }
  };

  const startSectionEdit = (section: Section) => {
    setEditSectionId(section.id);
    setEditSectionTitle(section.title);
  };

  const startSubtask = (task: TaskNode) => {
    setSubtaskParentId(task.id);
    setSubtaskTitle("");
  };

  const submitSubtask = (task: TaskNode) => {
    const trimmed = subtaskTitle.trim();

    if (trimmed.length > 0) {
      createSubtaskMutation.mutate(Object.freeze({ title: trimmed, parent: task }));
    }
  };

  const moveDroppedTask = (projectId: ProjectId | null, sectionId: SectionId | null) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/task-id");

    if (taskId.length > 0) {
      moveMutation.mutate(Object.freeze({ taskId, projectId, sectionId, parentId: null }));
    }
  };

  const allowDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
  };

  const startDragging = (task: TaskNode) => (event: DragEvent<HTMLElement>) => {
    setDraggingTaskId(task.id);
    event.dataTransfer.setData("text/task-id", task.id);
  };

  const moveTaskIntoTask = (target: TaskNode) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const taskId = event.dataTransfer.getData("text/task-id");
    const moved = findTaskNode(allTasks, taskId);

    if (moved === null || moved.id === target.id || hasDescendant(moved, target.id)) {
      setDraggingTaskId(null);
      setDragTargetTaskId(null);
      return;
    }

    moveMutation.mutate(Object.freeze({
      taskId,
      projectId: target.projectId,
      sectionId: target.sectionId,
      parentId: target.id
    }));
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
    startSubtask,
    startDragging,
    deleteTask: deleteMutation.mutate,
    submitSubtask,
    submitEdit,
    cancelSubtask: () => {
      setSubtaskParentId(null);
      setSubtaskTitle("");
    },
    cancelEdit: () => {
      setEditTaskId(null);
      setEditTitle("");
      setEditPlacement(inboxPlacement);
    },
    editTaskId,
    editTitle,
    editPlacement,
    subtaskParentId,
    subtaskTitle,
    draggingTaskId,
    dragTargetTaskId,
    placementOptions: createPlacementOptions(allProjects, allSections),
    moveTaskIntoTask,
    markDragTarget: (taskId: string | null) => setDragTargetTaskId(taskId),
    finishDragging: () => {
      setDraggingTaskId(null);
      setDragTargetTaskId(null);
    },
    setEditTitle,
    setEditPlacement,
    setSubtaskTitle
  });

  const taskTargetLabel =
    targetSectionId !== null
      ? inboxSections.find((section) => section.id === targetSectionId)?.title ?? "selected section"
      : targetProjectId !== null
        ? allProjects.find((project) => project.id === targetProjectId)?.title ?? "selected project"
        : "Inbox";
  const markdown = currentMarkdown(taskTargetLabel, inboxRootTasks, inboxSections, allTasks, targetProjectId);

  const copyMarkdown = async () => {
    await copyText(markdown);
    setCopyStatus("Markdown copied");
  };

  const exportZip = () => {
    downloadBlob(createZipBlob(allMarkdownFiles(allProjects, allSections, allTasks)), "todoist-clonse-markdown.zip");
  };

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
          <div className="export-actions" aria-label="Markdown export">
            <button type="button" onClick={copyMarkdown}>
              Copy markdown
            </button>
            <button type="button" onClick={() => setMarkdownModal(Object.freeze({ title: taskTargetLabel, markdown }))}>
              Preview markdown
            </button>
            <button type="button" onClick={exportZip}>
              Export all ZIP
            </button>
            {copyStatus.length > 0 ? <span className="muted">{copyStatus}</span> : null}
          </div>
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
                  <div className="section-header">
                    {editSectionId === section.id ? (
                      <form className="section-edit-form" onSubmit={submitSectionEdit(section)}>
                        <label htmlFor={`section-edit-${section.id}`}>Section title</label>
                        <input
                          id={`section-edit-${section.id}`}
                          value={editSectionTitle}
                          onChange={(event) => setEditSectionTitle(event.target.value)}
                        />
                        <button type="submit">Save section</button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditSectionId(null);
                            setEditSectionTitle("");
                          }}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <h2>{section.title}</h2>
                        <div className="section-actions">
                          <button type="button" aria-label={`Edit section ${section.title}`} onClick={() => startSectionEdit(section)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="danger"
                            aria-label={`Delete section ${section.title}`}
                            onClick={() => deleteSectionMutation.mutate(section)}
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
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
      {markdownModal !== null ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label="Markdown preview">
            <header className="modal-header">
              <h2>{markdownModal.title} markdown</h2>
              <button type="button" onClick={() => setMarkdownModal(null)}>
                Close
              </button>
            </header>
            <pre>{markdownModal.markdown}</pre>
          </section>
        </div>
      ) : null}
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
