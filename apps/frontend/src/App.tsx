import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { FloatingFocusManager, FloatingOverlay, useFloating } from "@floating-ui/react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  computeDropPlacement,
  computeIndentPlacement,
  computeOutdentPlacement,
  renderTaskMarkdownDocument
} from "@todoist-clone/domain";
import type { Project, ProjectId, Section, SectionId, Task, TaskId, TaskNode } from "@todoist-clone/domain";
import clsx from "clsx";
import JSZip from "jszip";
import { Archive, ClipboardCopy, Code2, Copy, Database, Download, Edit3, Eye, Inbox, KeyRound, MoreHorizontal, Plus, Settings, Trash2, X } from "lucide-react";
import type { DragEvent, FormEvent, KeyboardEvent, ReactElement } from "react";
import { useEffect, useState } from "react";
import "./vendor/bootstrap.min.css";
import { createTaskApi, createToolsApi } from "./api";
import type { AppSettings, ApplicationApi, ToolsApi } from "./api";
import "./App.css";

const taskQueryKey = Object.freeze(["tasks"]);
const projectQueryKey = Object.freeze(["projects"]);
const sectionQueryKey = Object.freeze(["sections"]);
const tablesQueryKey = Object.freeze(["tools", "tables"]);
const settingsQueryKey = Object.freeze(["app-settings"]);
const authStatusQueryKey = Object.freeze(["auth-status"]);
const toolsEnabled = import.meta.env.DEV || import.meta.env.MODE === "test";

type DragPlacement = "before" | "inside" | "after" | "outdent";

type DropZoneId = "inbox" | `project:${ProjectId}` | `section:${SectionId}`;

type ActiveDragTarget = Readonly<{
  taskId: TaskId;
  placement: DragPlacement;
}>;

type MoveInput = Readonly<{
  taskId: TaskId;
  projectId: ProjectId | null;
  sectionId: SectionId | null;
  parentId: TaskId | null;
  beforeId: TaskId | null;
  afterId: TaskId | null;
}>;

const renderTaskNodes = (
  tasks: ReadonlyArray<TaskNode>,
  actions: Readonly<{
    toggleTask: (task: TaskNode) => void;
    startEditing: (task: TaskNode) => void;
    openDetails: (task: TaskNode) => void;
    deleteTask: (task: TaskNode) => void;
    startSubtask: (task: TaskNode) => void;
    submitSubtask: (task: TaskNode) => void;
    cancelSubtask: () => void;
    moveTaskOntoTask: (task: TaskNode) => (event: DragEvent<HTMLElement>) => void;
    markDragTarget: (task: TaskNode) => (event: DragEvent<HTMLElement>) => void;
    clearDragTarget: () => void;
    finishDragging: () => void;
    startDragging: (task: TaskNode) => (event: DragEvent<HTMLElement>) => void;
    handleTaskKeys: (task: TaskNode) => (event: KeyboardEvent<HTMLElement>) => void;
    submitEdit: (task: TaskNode) => void;
    cancelEdit: () => void;
    editTaskId: string | null;
    editTitle: string;
    editPlacement: string;
    subtaskParentId: string | null;
    subtaskTitle: string;
    draggingTaskId: string | null;
    activeDragTarget: ActiveDragTarget | null;
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
          className={clsx(
            "task-row",
            actions.draggingTaskId === task.id && "dragging",
            actions.activeDragTarget?.taskId === task.id && ["drag-target", `drag-${actions.activeDragTarget.placement}`]
          )}
          data-task-id={task.id}
          data-task-depth={depth}
          tabIndex={0}
          draggable
          onDragStart={actions.startDragging(task)}
          onDragEnd={actions.finishDragging}
          onDragEnter={actions.markDragTarget(task)}
          onDragOver={actions.markDragTarget(task)}
          onDragLeave={actions.clearDragTarget}
          onDrop={actions.moveTaskOntoTask(task)}
          onKeyDown={actions.handleTaskKeys(task)}
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
                  autoFocus
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
            <button type="button" className={task.completed ? "task-title completed" : "task-title"} onClick={() => actions.openDetails(task)}>{task.title}</button>
          )}
          <button type="button" className="task-action" aria-label={`Edit task ${task.title}`} onClick={() => actions.startEditing(task)}>
            <Edit3 size={14} aria-hidden="true" />
            Edit
          </button>
          <button type="button" className="task-action" aria-label={`Add subtask to ${task.title}`} onClick={() => actions.startSubtask(task)}>
            <Plus size={14} aria-hidden="true" />
            Subtask
          </button>
          <button type="button" className="task-action danger" aria-label={`Delete task ${task.title}`} onClick={() => actions.deleteTask(task)}>
            <Trash2 size={14} aria-hidden="true" />
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
              autoFocus
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

const flattenTaskNodes = (tasks: ReadonlyArray<TaskNode>): ReadonlyArray<Task> =>
  Object.freeze(tasks.flatMap((task) => [task, ...flattenTaskNodes(task.children)]));

const hasDescendant = (task: TaskNode, id: string): boolean =>
  task.children.some((child) => child.id === id || hasDescendant(child, id));

const dragPlacementFromEvent = (event: DragEvent<HTMLElement>): DragPlacement => {
  const { top, left, height } = event.currentTarget.getBoundingClientRect();
  const pointerX = Number.isFinite(event.clientX) ? event.clientX : left;
  const pointerY = Number.isFinite(event.clientY) ? event.clientY : 0;
  const virtualY = Number.isFinite(height) && height > 0 ? null : pointerY;
  const y = pointerY - (Number.isFinite(top) ? top : 0);
  const indent = Number.parseFloat(event.currentTarget.style.paddingLeft || "0");
  const depth = Number.parseInt(event.currentTarget.dataset.taskDepth ?? "0", 10);

  if ((Number.isFinite(left) && pointerX < left - 18) || (pointerX <= 0 && (indent > 0 || depth > 0))) {
    return "outdent";
  }

  if (virtualY !== null) {
    return virtualY < 35 ? "before" : virtualY > 65 ? "after" : "inside";
  }

  return y < height * 0.35 ? "before" : y > height * 0.65 ? "after" : "inside";
};

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

const createZipBlob = async (files: ReadonlyArray<Readonly<{ name: string; content: string }>>) => {
  const zip = new JSZip();

  files.forEach((file) => zip.file(file.name, file.content));

  return zip.generateAsync({ type: "blob" });
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

export const TaskApp = ({ api }: Readonly<{ api: ApplicationApi }>) => {
  const [title, setTitle] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [editProjectId, setEditProjectId] = useState<ProjectId | null>(null);
  const [editProjectTitle, setEditProjectTitle] = useState("");
  const [editSectionId, setEditSectionId] = useState<SectionId | null>(null);
  const [editSectionTitle, setEditSectionTitle] = useState("");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskParentId, setSubtaskParentId] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [activeDragTarget, setActiveDragTarget] = useState<ActiveDragTarget | null>(null);
  const [activeDropZone, setActiveDropZone] = useState<DropZoneId | null>(null);
  const [targetProjectId, setTargetProjectId] = useState<ProjectId | null>(null);
  const [targetSectionId, setTargetSectionId] = useState<SectionId | null>(null);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPlacement, setEditPlacement] = useState(inboxPlacement);
  const [markdownModal, setMarkdownModal] = useState<Readonly<{ title: string; markdown: string }> | null>(null);
  const [detailsTaskId, setDetailsTaskId] = useState<TaskId | null>(null);
  const [detailTitle, setDetailTitle] = useState("");
  const [detailDescription, setDetailDescription] = useState("");
  const [detailDueDate, setDetailDueDate] = useState("");
  const [detailLabels, setDetailLabels] = useState("");
  const [detailComment, setDetailComment] = useState("");
  const [detailSubtask, setDetailSubtask] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const [openProjectMenuId, setOpenProjectMenuId] = useState<ProjectId | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const queryClient = useQueryClient();
  const markdownFloating = useFloating({ open: markdownModal !== null });
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: Object.freeze({ distance: 4 }) }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

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

  const settings = useQuery({
    queryKey: settingsQueryKey,
    queryFn: api.getSettings
  });

  const confirmDeletion = (message: string) => settings.data?.confirmDelete === false || window.confirm(message);

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

  const updateProjectMutation = useMutation({
    mutationFn: (project: Readonly<{ id: ProjectId; title: string }>) => api.updateProject(project.id, project.title),
    onSuccess: (project) => {
      setEditProjectId(null);
      setEditProjectTitle("");
      queryClient.setQueryData(projectQueryKey, (current: ReadonlyArray<Project> | undefined) => appendById(current, project));
    }
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (project: Project) => api.deleteProject(project.id).then(() => project),
    onSuccess: async (project) => {
      queryClient.setQueryData(projectQueryKey, (current: ReadonlyArray<Project> | undefined) => removeById(current, project.id));
      setTargetProjectId((current) => (current === project.id ? null : current));
      await queryClient.invalidateQueries({ queryKey: sectionQueryKey });
      await queryClient.invalidateQueries({ queryKey: taskQueryKey });
    }
  });

  const duplicateProjectMutation = useMutation({
    mutationFn: api.duplicateProject,
    onSuccess: async (project) => {
      queryClient.setQueryData(projectQueryKey, (current: ReadonlyArray<Project> | undefined) => appendById(current, project));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectQueryKey }),
        queryClient.invalidateQueries({ queryKey: sectionQueryKey }),
        queryClient.invalidateQueries({ queryKey: taskQueryKey })
      ]);
    }
  });
  const archiveProjectMutation = useMutation({ mutationFn: ({ id, archived }: Readonly<{ id: ProjectId; archived: boolean }>) => api.archiveProject(id, archived), onSuccess: (project) => queryClient.setQueryData(projectQueryKey, (current: ReadonlyArray<Project> | undefined) => appendById(current, project)) });

  const requestProjectDelete = (project: Project) => {
    if (confirmDeletion(`Delete project “${project.title}” and all its tasks?`)) {
      deleteProjectMutation.mutate(project);
    }
  };

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

  const requestSectionDelete = (section: Section) => {
    if (confirmDeletion(`Delete section “${section.title}”?`)) {
      deleteSectionMutation.mutate(section);
    }
  };

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
      const titleTask = await api.updateTask(task.id, Object.freeze({ title: editTitle.trim() }));

      return taskPlacement(task) === editPlacement
        ? titleTask
        : api.moveTask(task.id, placement.projectId, placement.sectionId, null, null, null);
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

  const requestTaskDelete = (task: TaskNode) => {
    if (confirmDeletion(`Delete task “${task.title}” and its subtasks?`)) {
      deleteMutation.mutate(task);
    }
  };

  const moveMutation = useMutation({
    mutationFn: (placement: MoveInput) =>
      api.moveTask(
        placement.taskId,
        placement.projectId,
        placement.sectionId,
        placement.parentId,
        placement.beforeId,
        placement.afterId
      ),
    onSuccess: async () => {
      setDraggingTaskId(null);
      setActiveDragTarget(null);
      setActiveDropZone(null);
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

  const submitProjectEdit = (project: Project) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = editProjectTitle.trim();

    if (trimmed.length > 0) {
      updateProjectMutation.mutate(Object.freeze({ id: project.id, title: trimmed }));
    }
  };

  const startProjectEdit = (project: Project) => {
    setEditProjectId(project.id);
    setEditProjectTitle(project.title);
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

  const dropZoneId = (projectId: ProjectId | null, sectionId: SectionId | null): DropZoneId =>
    sectionId !== null ? `section:${sectionId}` : projectId !== null ? `project:${projectId}` : "inbox";

  const markDropZone = (projectId: ProjectId | null, sectionId: SectionId | null) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setActiveDropZone(dropZoneId(projectId, sectionId));
  };

  const moveDroppedTask = (projectId: ProjectId | null, sectionId: SectionId | null) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/task-id");

    if (taskId.length > 0) {
      moveMutation.mutate(Object.freeze({ taskId, projectId, sectionId, parentId: null, beforeId: null, afterId: null }));
    }
  };

  const allowDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
  };

  const startDragging = (task: TaskNode) => (event: DragEvent<HTMLElement>) => {
    setDraggingTaskId(task.id);
    setActiveDropZone(null);
    event.dataTransfer.setData("text/task-id", task.id);
  };

  const moveTaskOntoTask = (target: TaskNode) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const taskId = event.dataTransfer.getData("text/task-id");
    const moved = findTaskNode(allTasks, taskId);

    if (moved === null || hasDescendant(moved, target.id)) {
      setDraggingTaskId(null);
      setActiveDragTarget(null);
      return;
    }

    const placement = dragPlacementFromEvent(event);
    const nextPlacement =
      placement === "outdent" || (moved.id === target.id && moved.parentId !== null)
        ? computeOutdentPlacement(flatTasks, moved)
        : moved.id === target.id
          ? null
          : placement === "inside"
        ? Object.freeze({
            parentId: target.id,
            projectId: target.projectId,
            sectionId: target.sectionId,
            beforeId: null,
            afterId: null
          })
        : computeDropPlacement(flatTasks, moved, target, placement);

    if (nextPlacement !== null) {
      moveMutation.mutate(Object.freeze({ taskId, ...nextPlacement }));
      return;
    }

    setDraggingTaskId(null);
    setActiveDragTarget(null);
  };

  const markDragTarget = (task: TaskNode) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setActiveDragTarget(Object.freeze({ taskId: task.id, placement: dragPlacementFromEvent(event) }));
  };

  const moveByPlacement = (task: TaskNode, placement: ReturnType<typeof computeIndentPlacement>) => {
    if (placement !== null) {
      moveMutation.mutate(Object.freeze({ taskId: task.id, ...placement }));
    }
  };

  const handleTaskKeys = (task: TaskNode) => (event: KeyboardEvent<HTMLElement>) => {
    if (!(event.metaKey || event.ctrlKey) || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) {
      return;
    }

    event.preventDefault();
    moveByPlacement(task, event.key === "ArrowRight" ? computeIndentPlacement(flatTasks, task) : computeOutdentPlacement(flatTasks, task));
  };

  const startEditing = (task: TaskNode) => {
    setEditTaskId(task.id);
    setEditTitle(task.title);
    setEditPlacement(taskPlacement(task));
  };

  const openDetails = (task: TaskNode) => {
    setDetailsTaskId(task.id);
    setDetailTitle(task.title);
    setDetailDescription(task.description);
    setDetailDueDate(task.dueDate ?? "");
    setDetailLabels(task.labels.join(", "));
  };

  const submitEdit = (task: TaskNode) => {
    if (editTitle.trim().length === 0) {
      return;
    }

    editMutation.mutate(task);
  };

  const allTasks = tasks.data ?? Object.freeze([]);
  const flatTasks = flattenTaskNodes(allTasks);
  const allProjects = projects.data ?? Object.freeze([]);
  const activeProjects = allProjects.filter((project) => !project.archived);
  const allSections = sections.data ?? Object.freeze([]);
  const selectedDetailsTask = detailsTaskId === null ? null : findTaskNode(allTasks, detailsTaskId);
  const inboxSections = allSections.filter((section) => section.projectId === null);
  const inboxRootTasks = allTasks.filter((task) => task.projectId === null && task.sectionId === null);

  const taskActions = Object.freeze({
    toggleTask: toggleMutation.mutate,
    startEditing,
    openDetails,
    startSubtask,
    startDragging,
    deleteTask: requestTaskDelete,
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
    activeDragTarget,
    placementOptions: createPlacementOptions(activeProjects, allSections),
    moveTaskOntoTask,
    markDragTarget,
    clearDragTarget: () => setActiveDragTarget(null),
    finishDragging: () => {
      setDraggingTaskId(null);
      setActiveDragTarget(null);
    },
    handleTaskKeys,
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

  const finishDndDrag = (_event: DragEndEvent) => {
    setDraggingTaskId(null);
    setActiveDragTarget(null);
    setActiveDropZone(null);
  };

  const exportZip = async () => {
    downloadBlob(await createZipBlob(allMarkdownFiles(allProjects, allSections, allTasks)), "todoist-clone-markdown.zip");
  };

  const allMarkdown = allMarkdownFiles(allProjects, allSections, allTasks)
    .map((file) => file.content)
    .join("\n\n---\n\n");

  const exportMarkdown = () => {
    downloadBlob(new Blob([allMarkdown], { type: "text/markdown;charset=utf-8" }), "todoist-clone.md");
  };

  return (
    <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={finishDndDrag}>
    <main className="shell app-layout">
      <aside className="sidebar card shadow-sm" aria-label="Navigation">
        <div className="sidebar-brand">
          <span className="brand-mark">T</span>
          <strong>Todoist Clone</strong>
        </div>
        <button
          type="button"
          className={["nav-button", targetProjectId === null && targetSectionId === null ? "active" : ""].filter(Boolean).join(" ")}
          onClick={() => {
            setTargetProjectId(null);
            setTargetSectionId(null);
          }}
          onDragEnter={markDropZone(null, null)}
          onDragOver={markDropZone(null, null)}
          onDragLeave={() => setActiveDropZone(null)}
          onDrop={moveDroppedTask(null, null)}
        >
          <Inbox size={16} aria-hidden="true" />
          Inbox
        </button>
        {toolsEnabled ? (
          <a className="nav-button nav-link-button" href="/tools">
            <Code2 size={16} aria-hidden="true" />
            Tools
          </a>
        ) : null}
        <a className="nav-button nav-link-button" href="/settings">
          <Settings size={16} aria-hidden="true" />
          Settings
        </a>
        <a className="nav-button nav-link-button" href="/archived-projects"><Archive size={16} aria-hidden="true" /> Archived projects</a>
        <div className="sidebar-group">
          <h2>My Projects</h2>
          {activeProjects.map((project) =>
            editProjectId === project.id ? (
              <form key={project.id} className="project-edit-form" onSubmit={submitProjectEdit(project)}>
                <label htmlFor={`project-edit-${project.id}`}>Project title</label>
                <input
                  id={`project-edit-${project.id}`}
                  value={editProjectTitle}
                  onChange={(event) => setEditProjectTitle(event.target.value)}
                />
                <button type="submit">Save project</button>
                <button
                  type="button"
                  onClick={() => {
                    setEditProjectId(null);
                    setEditProjectTitle("");
                  }}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div key={project.id} className="project-nav-row">
                <button
                  type="button"
                  className={clsx(
                    "nav-button",
                    targetProjectId === project.id && "active",
                    activeDropZone === projectPlacement(project.id) && "drop-active"
                  )}
                  onClick={() => {
                    setTargetProjectId(project.id);
                    setTargetSectionId(null);
                  }}
                  onDragEnter={markDropZone(project.id, null)}
                  onDragOver={markDropZone(project.id, null)}
                  onDragLeave={() => setActiveDropZone(null)}
                  onDrop={moveDroppedTask(project.id, null)}
                >
                  {project.title}
                </button>
                <details className="project-menu" open={openProjectMenuId === project.id}>
                  <summary aria-label={`Project menu ${project.title}`} onClick={(event) => { event.preventDefault(); setOpenProjectMenuId((current) => current === project.id ? null : project.id); }}><MoreHorizontal size={17} aria-hidden="true" /></summary>
                  <div className="project-menu-items">
                    <button type="button" onClick={() => { setOpenProjectMenuId(null); startProjectEdit(project); }}><Edit3 size={14} aria-hidden="true" /> Edit</button>
                    <button type="button" onClick={() => { setOpenProjectMenuId(null); duplicateProjectMutation.mutate(project.id); }}><Copy size={14} aria-hidden="true" /> Duplicate</button>
                    <button type="button" onClick={() => { setOpenProjectMenuId(null); archiveProjectMutation.mutate({ id: project.id, archived: true }); if (targetProjectId === project.id) { setTargetProjectId(null); setTargetSectionId(null); } }}><Archive size={14} aria-hidden="true" /> Archive</button>
                    <button type="button" className="danger" onClick={() => { setOpenProjectMenuId(null); requestProjectDelete(project); }}><Trash2 size={14} aria-hidden="true" /> Delete</button>
                  </div>
                </details>
              </div>
            )
          )}
        </div>
        <div className="card bg-light border p-3 sidebar-create-block">
          <form className="compact-form m-0" onSubmit={submitProject}>
            <label htmlFor="project-title">Project title</label>
            <input id="project-title" value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} />
            <button type="submit"><Plus size={16} aria-hidden="true" />Add project</button>
          </form>
        </div>
        <button type="button" className="nav-button sidebar-export" onClick={exportZip}>
          <Archive size={16} aria-hidden="true" />
          Export all ZIP
        </button>
        <button type="button" className="nav-button sidebar-export" onClick={exportMarkdown}>
          <Download size={16} aria-hidden="true" />
          Export all markdown
        </button>
        <button type="button" className="nav-button sidebar-export" onClick={async () => { await copyText(allMarkdown); setCopyStatus("All markdown copied"); }}>
          <ClipboardCopy size={16} aria-hidden="true" />
          Copy all markdown
        </button>
        <button
          type="button"
          className="nav-button sidebar-export"
          onClick={() => setMarkdownModal(Object.freeze({ title: "All tasks", markdown: allMarkdown }))}
        >
          <Eye size={16} aria-hidden="true" />
          Preview all markdown
        </button>
      </aside>

      <section className="workspace card shadow-sm" aria-label="Task manager">
        <header className="header">
          <p className="eyebrow">Self-hosted MVP</p>
          <h1>{targetProjectId === null ? "Inbox" : taskTargetLabel}</h1>
          <div className="export-actions" aria-label="Markdown export">
            <button type="button" onClick={copyMarkdown}>
              <ClipboardCopy size={16} aria-hidden="true" />
              Copy markdown
            </button>
            <button type="button" onClick={() => setMarkdownModal(Object.freeze({ title: taskTargetLabel, markdown }))}>
              <Database size={16} aria-hidden="true" />
              Preview markdown
            </button>
            {copyStatus.length > 0 ? <span className="muted">{copyStatus}</span> : null}
          </div>
        </header>

        <div className="card bg-light border p-3 task-create-block mb-3">
          <form className="task-form m-0" onSubmit={submit}>
            <label className="input-label" htmlFor="task-title">Task title for {taskTargetLabel}</label>
            <div className="input-row">
              <input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a task" />
              <button type="submit" disabled={createMutation.isPending}><Plus size={16} aria-hidden="true" />Add task</button>
            </div>
          </form>
        </div>

        {tasks.isLoading ? <p className="muted">Loading tasks...</p> : null}
        {tasks.isError ? <p className="error">Unable to load tasks.</p> : null}
        {targetProjectId === null ? (
          <div className="board">
            <section
              className={clsx("drop-zone", activeDropZone === "inbox" && "drop-active")}
              onDragEnter={markDropZone(null, null)}
              onDragOver={markDropZone(null, null)}
              onDragLeave={() => setActiveDropZone(null)}
              onDrop={moveDroppedTask(null, null)}
              aria-label="Inbox tasks"
            >
              <h2>Inbox</h2>
              {inboxRootTasks.length > 0 ? renderTaskNodes(inboxRootTasks, taskActions) : <p className="empty">No inbox tasks yet.</p>}
            </section>
            <div className="card bg-light border p-3 section-create-block">
              <form className="compact-form inline m-0" onSubmit={submitSection}>
                <label htmlFor="section-title">Section title</label>
                <input id="section-title" value={sectionTitle} onChange={(event) => setSectionTitle(event.target.value)} />
                <button type="submit"><Plus size={16} aria-hidden="true" />Add section</button>
              </form>
            </div>
            {inboxSections.map((section) => {
              const sectionTasks = allTasks.filter((task) => task.projectId === null && task.sectionId === section.id);

              return (
                <section
                  key={section.id}
                  className={clsx("drop-zone", activeDropZone === sectionPlacement(section.id) && "drop-active")}
                  onDragEnter={markDropZone(null, section.id)}
                  onDragOver={markDropZone(null, section.id)}
                  onDragLeave={() => setActiveDropZone(null)}
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
                            <Edit3 size={14} aria-hidden="true" />
                            Edit
                          </button>
                          <button
                            type="button"
                            className="danger"
                            aria-label={`Delete section ${section.title}`}
                            onClick={() => requestSectionDelete(section)}
                          >
                            <Trash2 size={14} aria-hidden="true" />
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
          <section
            className={clsx("drop-zone", activeDropZone === projectPlacement(targetProjectId) && "drop-active")}
            onDragEnter={markDropZone(targetProjectId, null)}
            onDragOver={markDropZone(targetProjectId, null)}
            onDragLeave={() => setActiveDropZone(null)}
            onDrop={moveDroppedTask(targetProjectId, null)}
            aria-label={`${taskTargetLabel} tasks`}
          >
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
        <FloatingOverlay className="markdown-modal-backdrop" lockScroll>
          <FloatingFocusManager context={markdownFloating.context}>
          <section
            ref={markdownFloating.refs.setFloating}
            className="markdown-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Markdown preview"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setMarkdownModal(null);
              }
            }}
          >
            <header className="markdown-modal-header">
              <h2>{markdownModal.title} markdown</h2>
              <button type="button" onClick={() => setMarkdownModal(null)}>
                <X size={16} aria-hidden="true" />
                Close
              </button>
            </header>
            <pre>{markdownModal.markdown}</pre>
          </section>
          </FloatingFocusManager>
        </FloatingOverlay>
      ) : null}
      {selectedDetailsTask !== null ? (
        <div className="task-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailsTaskId(null); }}>
          <section className="task-details-modal" role="dialog" aria-modal="true" aria-label={`Task details: ${selectedDetailsTask.title}`} onKeyDown={(event) => { if (event.key === "Escape") setDetailsTaskId(null); }}>
            <header><h2>Task details</h2><button type="button" aria-label="Close task details" onClick={() => setDetailsTaskId(null)}><X size={18} /></button></header>
            <form onSubmit={async (event) => {
              event.preventDefault();
              await api.updateTask(selectedDetailsTask.id, { title: detailTitle.trim(), description: detailDescription, dueDate: detailDueDate || null, labels: detailLabels.split(",").map((label) => label.trim()).filter(Boolean) });
              await queryClient.invalidateQueries({ queryKey: taskQueryKey });
              setDetailsTaskId(null);
            }}>
              <label>Title<input autoFocus value={detailTitle} onChange={(event) => setDetailTitle(event.target.value)} required /></label>
              <label>Description<textarea value={detailDescription} onChange={(event) => setDetailDescription(event.target.value)} rows={4} /></label>
              <label>Date<input type="date" value={detailDueDate} onChange={(event) => setDetailDueDate(event.target.value)} /></label>
              <label>Labels<input value={detailLabels} onChange={(event) => setDetailLabels(event.target.value)} placeholder="Comma separated labels" /></label>
              <fieldset><legend>Subtasks</legend>
                {selectedDetailsTask.children.map((child) => <div className="details-subtask-row" key={child.id}><button type="button" className="details-subtask" onClick={() => openDetails(child)}>{child.title}</button><button type="button" aria-label={`Delete subtask ${child.title}`} onClick={async () => { if (!confirmDeletion(`Delete subtask “${child.title}” and its descendants?`)) return; await api.deleteTask(child.id); await queryClient.invalidateQueries({ queryKey: taskQueryKey }); }}>Delete</button></div>)}
                <div className="details-subtask-add"><input aria-label="New subtask title" value={detailSubtask} onChange={(event) => setDetailSubtask(event.target.value)} placeholder="Add subtask" /><button type="button" onClick={async () => { const title = detailSubtask.trim(); if (!title) return; await api.createTask(title, selectedDetailsTask.projectId, selectedDetailsTask.sectionId, selectedDetailsTask.id); setDetailSubtask(""); await queryClient.invalidateQueries({ queryKey: taskQueryKey }); }}>Add</button></div>
              </fieldset>
              <section className="task-comments"><h3>Comments</h3>
                {selectedDetailsTask.comments.map((comment) => <article className="task-comment" key={comment.id}>
                  {editingCommentId === comment.id ? <><textarea aria-label={`Edit comment ${comment.id}`} value={editingCommentBody} onChange={(event) => setEditingCommentBody(event.target.value)} rows={2} /><div><button type="button" onClick={async () => { const comments = selectedDetailsTask.comments.map((item) => item.id === comment.id ? Object.freeze({ ...item, body: editingCommentBody.trim() }) : item); await api.updateTask(selectedDetailsTask.id, { comments }); setEditingCommentId(null); await queryClient.invalidateQueries({ queryKey: taskQueryKey }); }}>Save comment</button><button type="button" onClick={() => setEditingCommentId(null)}>Cancel</button></div></> : <><p>{comment.body}</p><small>{new Date(comment.createdAt).toLocaleString()}</small><div><button type="button" onClick={() => { setEditingCommentId(comment.id); setEditingCommentBody(comment.body); }}>Edit</button><button type="button" className="danger" onClick={async () => { if (!confirmDeletion("Delete this comment?")) return; await api.updateTask(selectedDetailsTask.id, { comments: selectedDetailsTask.comments.filter((item) => item.id !== comment.id) }); await queryClient.invalidateQueries({ queryKey: taskQueryKey }); }}>Delete</button></div></>}
                </article>)}
                <label>Add comment<textarea value={detailComment} onChange={(event) => setDetailComment(event.target.value)} rows={2} /></label>
                <button type="button" disabled={!detailComment.trim()} onClick={async () => { const comments = [...selectedDetailsTask.comments, { id: crypto.randomUUID(), body: detailComment.trim(), createdAt: new Date().toISOString() }]; await api.updateTask(selectedDetailsTask.id, { comments }); setDetailComment(""); await queryClient.invalidateQueries({ queryKey: taskQueryKey }); }}>Add comment</button>
              </section>
              <footer><button type="button" onClick={() => setDetailsTaskId(null)}>Cancel</button><button type="submit">Save task</button></footer>
            </form>
          </section>
        </div>
      ) : null}
    </main>
    </DndContext>
  );
};

export const ToolsPage = ({ api }: Readonly<{ api: ToolsApi }>) => {
  const [selectedTable, setSelectedTable] = useState("");
  const [sql, setSql] = useState("SELECT * FROM tasks ORDER BY lexical_order;");
  const [result, setResult] = useState<unknown>(Object.freeze({ ready: true }));
  const [recordsLimit, setRecordsLimit] = useState<"10" | "100" | "all">("10");
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

  const viewRecords = useMutation({ mutationFn: () => api.listRecords(tableValue, recordsLimit), onSuccess: setResult });

  if (!toolsEnabled) {
    return (
      <main className="shell app-layout">
        <aside className="sidebar card shadow-sm" aria-label="Navigation">
          <div className="sidebar-brand">
            <span className="brand-mark">T</span>
            <strong>Todoist Clone</strong>
          </div>
          <a className="nav-button nav-link-button" href="/">
            <Inbox size={16} aria-hidden="true" />
            Inbox
          </a>
        </aside>
        <section className="workspace card shadow-sm" aria-label="Developer tools disabled">
          <h1>Not found</h1>
        </section>
      </main>
    );
  }

  const tableOptions = tables.data ?? Object.freeze([]);
  const tableValue = selectedTable || tableOptions[0] || "";

  return (
    <main className="shell app-layout">
      <aside className="sidebar card shadow-sm" aria-label="Navigation">
        <div className="sidebar-brand">
          <span className="brand-mark">T</span>
          <strong>Todoist Clone</strong>
        </div>
        <a className="nav-button nav-link-button" href="/">
          <Inbox size={16} aria-hidden="true" />
          Inbox
        </a>
        <a className="nav-button nav-link-button active" href="/tools">
          <Code2 size={16} aria-hidden="true" />
          Tools
        </a>
        <a className="nav-button nav-link-button" href="/settings">
          <Settings size={16} aria-hidden="true" />
          Settings
        </a>
      </aside>
      <section className="workspace card shadow-sm tools-panel" aria-label="Database tools">
        <header className="header">
          <div><p className="eyebrow">Development tools</p><h1>Database Tools</h1><p className="tools-description">Browse table data, run SQL, and maintain the local database.</p></div>
        </header>

        <section className="card tools-card" aria-label="Browse table records">
          <div className="card-body">
            <div className="tools-card-heading"><Database size={20} /><div><h2>Browse table records</h2><p>Select a table and choose how many recent rows to inspect.</p></div></div>
            <div className="tools-grid">
              <label className="input-label" htmlFor="table-select">Table</label>
              <select id="table-select" value={tableValue} onChange={(event) => setSelectedTable(event.target.value)}>
                {tableOptions.map((table) => <option key={table} value={table}>{table}</option>)}
              </select>
              <label className="input-label" htmlFor="record-limit">Rows to view</label>
              <select id="record-limit" value={recordsLimit} onChange={(event) => setRecordsLimit(event.target.value as "10" | "100" | "all")}>
                <option value="10">Last 10</option><option value="100">Last 100</option><option value="all">All rows</option>
              </select>
              <button type="button" className="btn btn-primary" disabled={tableValue.length === 0 || viewRecords.isPending} onClick={() => viewRecords.mutate()}>{viewRecords.isPending ? "Loading records…" : "View records"}</button>
              <button type="button" className="btn btn-outline-danger" disabled={tableValue.length === 0} onClick={() => clearTable.mutate(tableValue)}>Clear selected table</button>
            </div>
          </div>
        </section>

        <section className="card tools-card tools-maintenance" aria-label="Database maintenance">
          <div className="card-body">
            <div className="tools-card-heading"><Archive size={20} /><div><h2>Database maintenance</h2><p>Run migrations or manage development data.</p></div></div>
            <div className="tools-maintenance-actions">
              <button type="button" className="btn btn-outline-secondary" onClick={runAction(api.migrate)}>Run migrations</button>
              <button type="button" className="btn btn-outline-secondary" onClick={runAction(api.seed)}>Seed test data</button>
              <button type="button" className="btn btn-outline-danger" onClick={runAction(api.clearAllTables)}>Clear all tables</button>
              <button type="button" className="btn btn-danger" onClick={runAction(api.dropAllTables)}>Drop all tables</button>
            </div>
          </div>
        </section>

        <form
          className="sql-form card p-3"
          onSubmit={(event) => {
            event.preventDefault();
            runQuery.mutate(sql);
          }}
        >
          <label className="input-label" htmlFor="sql-query">
            <span><Code2 size={16} aria-hidden="true" /> PostgreSQL query</span>
          </label>
          <textarea id="sql-query" value={sql} onChange={(event) => setSql(event.target.value)} />
          <button type="submit">Run query</button>
        </form>

        <section className="card tools-result-card"><header><h2>Result</h2><span>{runQuery.isPending || viewRecords.isPending ? "Loading" : "Ready"}</span></header><pre className="query-result">{JSON.stringify(result, null, 2)}</pre></section>
      </section>
    </main>
  );
};

export const SettingsPage = ({ api }: Readonly<{ api: ApplicationApi }>) => {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: settingsQueryKey, queryFn: api.getSettings });
  const authStatus = useQuery({ queryKey: authStatusQueryKey, queryFn: api.getAuthStatus });
  const [confirmDelete, setConfirmDelete] = useState(true);
  const [accessMode, setAccessMode] = useState<AppSettings["accessMode"]>("anonymous");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (settings.data !== undefined) {
      setConfirmDelete(settings.data.confirmDelete);
      setAccessMode(settings.data.accessMode);
      setUsername(settings.data.username ?? "");
    }
  }, [settings.data]);

  const saveSettings = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: async (nextSettings) => {
      queryClient.setQueryData(settingsQueryKey, nextSettings);
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: authStatusQueryKey });
    }
  });

  const logOut = async () => {
    await api.logout();
    await queryClient.invalidateQueries({ queryKey: authStatusQueryKey });
  };

  return (
    <main className="shell app-layout">
      <aside className="sidebar card shadow-sm" aria-label="Navigation">
        <div className="sidebar-brand">
          <span className="brand-mark">T</span>
          <strong>Todoist Clone</strong>
        </div>
        <a className="nav-button nav-link-button" href="/">
          <Inbox size={16} aria-hidden="true" />
          Inbox
        </a>
        {toolsEnabled ? (
          <a className="nav-button nav-link-button" href="/tools">
            <Code2 size={16} aria-hidden="true" />
            Tools
          </a>
        ) : null}
        <a className="nav-button nav-link-button active" href="/settings">
          <Settings size={16} aria-hidden="true" />
          Settings
        </a>
      </aside>
      <section className="workspace card shadow-sm settings-panel" aria-label="Settings">
        <header className="header">
          <h1>Settings</h1>
          <p className="settings-intro">Manage confirmations and access to your task workspace.</p>
        </header>

        {settings.isLoading ? <p className="muted">Loading settings…</p> : null}
        {settings.isError ? <p className="error">Unable to load settings.</p> : null}
        {settings.data !== undefined ? (
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              saveSettings.mutate({
                confirmDelete,
                accessMode,
                username: username.trim() || null,
                ...(password.length > 0 ? { password } : {})
              });
            }}
          >
            <fieldset className="settings-group">
              <legend>Deletion</legend>
              <label className="settings-checkbox">
                <input type="checkbox" checked={confirmDelete} onChange={(event) => setConfirmDelete(event.target.checked)} />
                Ask for confirmation before deleting tasks, projects, or sections
              </label>
              <p className="settings-help">Enabled by default. This setting applies to all delete actions.</p>
            </fieldset>

            <fieldset className="settings-group">
              <legend>Workspace access</legend>
              <label className="settings-choice">
                <input type="radio" name="access-mode" value="anonymous" checked={accessMode === "anonymous"} onChange={() => setAccessMode("anonymous")} />
                <span>
                  <strong>Anonymous access</strong>
                  <small>Anyone who can reach this app can use it.</small>
                </span>
              </label>
              <label className="settings-choice">
                <input type="radio" name="access-mode" value="password" checked={accessMode === "password"} onChange={() => setAccessMode("password")} />
                <span>
                  <strong>Require login and password</strong>
                  <small>Protect task data and tools behind a session.</small>
                </span>
              </label>

              {accessMode === "password" ? (
                <div className="settings-credentials">
                  <label>
                    Login
                    <input autoComplete="username" maxLength={64} required value={username} onChange={(event) => setUsername(event.target.value)} />
                  </label>
                  <label>
                    {settings.data.username === null ? "Password" : "New password"}
                    <input
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      required={settings.data.username === null}
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </label>
                  <p className="settings-help">Use at least 12 characters. Leave the password blank to keep the current one.</p>
                </div>
              ) : null}
            </fieldset>

            {saveSettings.isError ? <p className="error" role="alert">Unable to save settings. Check the login and password requirements.</p> : null}
            {saveSettings.isSuccess ? <p className="settings-success" role="status">Settings saved.</p> : null}
            <div className="settings-actions">
              <button className="settings-save" type="submit" disabled={saveSettings.isPending}>
                Save settings
              </button>
              {authStatus.data?.accessMode === "password" && authStatus.data.authenticated ? (
                <button className="settings-logout" type="button" onClick={() => void logOut()}>
                  <KeyRound size={16} aria-hidden="true" />
                  Log out
                </button>
              ) : null}
            </div>
          </form>
        ) : null}
      </section>
    </main>
  );
};

export const ArchivedProjectsPage = ({ api }: Readonly<{ api: ApplicationApi }>) => {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | null>(null);
  const projects = useQuery({ queryKey: projectQueryKey, queryFn: api.listProjects });
  const tasks = useQuery({ queryKey: taskQueryKey, queryFn: api.listTasks });
  const archived = (projects.data ?? []).filter((project) => project.archived);
  const restore = async (project: Project) => { await api.archiveProject(project.id, false); await queryClient.invalidateQueries({ queryKey: projectQueryKey }); };
  const remove = async (project: Project) => {
    if (!window.confirm(`Delete project “${project.title}” and all its tasks?`)) return;
    await api.deleteProject(project.id);
    await queryClient.invalidateQueries({ queryKey: projectQueryKey });
    await queryClient.invalidateQueries({ queryKey: taskQueryKey });
  };
  const renderTasks = (nodes: ReadonlyArray<TaskNode>): ReactElement => <ul className="archived-task-tree">{nodes.map((task) => <li key={task.id}><strong>{task.title}</strong>{task.description ? <p>{task.description}</p> : null}<div className="archived-task-meta">{task.dueDate ? <span>Due {task.dueDate}</span> : null}{task.labels.map((label) => <span className="badge text-bg-light" key={label}>{label}</span>)}</div>{task.children.length ? renderTasks(task.children) : null}</li>)}</ul>;
  const selectedProject = archived.find((project) => project.id === selectedProjectId);
  const archivedTaskRoots = (tasks.data ?? []).filter((task) => task.projectId === selectedProjectId && task.parentId === null);
  return <main className="shell app-layout">
    <aside className="sidebar card shadow-sm" aria-label="Navigation"><div className="sidebar-brand"><span className="brand-mark">T</span><strong>Todoist Clone</strong></div><a className="nav-button nav-link-button" href="/"><Inbox size={16} /> Inbox</a><a className="nav-button nav-link-button active" href="/archived-projects"><Archive size={16} /> Archived projects</a></aside>
    <section className="workspace card shadow-sm"><h1>Archived projects</h1>
      {archived.length === 0 ? <p className="empty">No archived projects.</p> : archived.map((project) => <article className="archived-project" key={project.id}><strong>{project.title}</strong><div><button type="button" onClick={() => setSelectedProjectId((current) => current === project.id ? null : project.id)}>{selectedProjectId === project.id ? "Hide tasks" : "View tasks"}</button><button type="button" onClick={() => void restore(project)}>Restore</button><button type="button" className="danger" onClick={() => void remove(project)}>Delete</button></div></article>)}
      {selectedProject !== undefined ? <section className="archived-task-view" aria-label={`${selectedProject.title} tasks`}><h2>{selectedProject.title} tasks</h2>{tasks.isLoading ? <p>Loading tasks…</p> : archivedTaskRoots.length === 0 ? <p className="empty">This project has no tasks.</p> : renderTasks(archivedTaskRoots)}</section> : null}
    </section>
  </main>;
};

const LoginPage = ({ api }: Readonly<{ api: ApplicationApi }>) => {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: async () => {
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: authStatusQueryKey });
    }
  });

  return (
    <main className="shell auth-shell">
      <section className="workspace card auth-panel" aria-label="Sign in">
        <div className="sidebar-brand">
          <span className="brand-mark">T</span>
          <strong>Todoist Clone</strong>
        </div>
        <h1>Sign in</h1>
        <form className="auth-form" onSubmit={(event) => { event.preventDefault(); login.mutate(); }}>
          <label>
            Login
            <input autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            Password
            <input autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {login.isError ? <p className="error" role="alert">Login or password is incorrect.</p> : null}
          <button className="settings-save" type="submit" disabled={login.isPending}>Sign in</button>
        </form>
      </section>
    </main>
  );
};

const AppRouter = () => {
  const api = createTaskApi();
  const authStatus = useQuery({ queryKey: authStatusQueryKey, queryFn: api.getAuthStatus });
  const path = window.location.pathname;

  if (authStatus.isLoading) {
    return <main className="auth-loading">Loading…</main>;
  }

  if (authStatus.isError || authStatus.data === undefined) {
    return <main className="auth-loading error">Unable to check workspace access.</main>;
  }

  if (authStatus.data.accessMode === "password" && !authStatus.data.authenticated) {
    return <LoginPage api={api} />;
  }

  if (path.startsWith("/settings")) {
    return <SettingsPage api={api} />;
  }

  if (path.startsWith("/archived-projects")) return <ArchivedProjectsPage api={api} />;

  if (path.startsWith("/tools")) {
    return <ToolsPage api={createToolsApi()} />;
  }

  return <TaskApp api={api} />;
};

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

export const App = () => <QueryClientProvider client={createQueryClient()}><AppRouter /></QueryClientProvider>;
