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
} from "@todoist-clonse/domain";
import type { Project, ProjectId, Section, SectionId, Task, TaskId, TaskNode } from "@todoist-clonse/domain";
import clsx from "clsx";
import JSZip from "jszip";
import { Archive, ClipboardCopy, Code2, Database, Edit3, Inbox, Plus, Trash2, X } from "lucide-react";
import type { DragEvent, FormEvent, KeyboardEvent, ReactElement } from "react";
import { useState } from "react";
import "./vendor/bootstrap.min.css";
import { createTaskApi, createToolsApi } from "./api";
import type { TaskApi, ToolsApi } from "./api";
import "./App.css";

const taskQueryKey = Object.freeze(["tasks"]);
const projectQueryKey = Object.freeze(["projects"]);
const sectionQueryKey = Object.freeze(["sections"]);
const tablesQueryKey = Object.freeze(["tools", "tables"]);
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
            <span className={task.completed ? "task-title completed" : "task-title"}>{task.title}</span>
          )}
          <span className="priority">P{task.priority}</span>
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

export const TaskApp = ({ api }: Readonly<{ api: TaskApi }>) => {
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

  const submitEdit = (task: TaskNode) => {
    if (editTitle.trim().length === 0) {
      return;
    }

    editMutation.mutate(task);
  };

  const allTasks = tasks.data ?? Object.freeze([]);
  const flatTasks = flattenTaskNodes(allTasks);
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
    activeDragTarget,
    placementOptions: createPlacementOptions(allProjects, allSections),
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
    downloadBlob(await createZipBlob(allMarkdownFiles(allProjects, allSections, allTasks)), "todoist-clonse-markdown.zip");
  };

  const allMarkdown = allMarkdownFiles(allProjects, allSections, allTasks)
    .map((file) => file.content)
    .join("\n\n---\n\n");

  const exportMarkdown = () => {
    downloadBlob(new Blob([allMarkdown], { type: "text/markdown;charset=utf-8" }), "todoist-clonse.md");
  };

  return (
    <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={finishDndDrag}>
    <main className="shell app-layout">
      <aside className="sidebar card shadow-sm" aria-label="Navigation">
        <div className="sidebar-brand">
          <span className="brand-mark">T</span>
          <strong>Todoist Clonse</strong>
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
        <div className="sidebar-group">
          <h2>My Projects</h2>
          {allProjects.map((project) =>
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
                <button type="button" aria-label={`Edit project ${project.title}`} onClick={() => startProjectEdit(project)}>
                  <Edit3 size={14} aria-hidden="true" />
                  Edit
                </button>
                <button
                  type="button"
                  className="danger"
                  aria-label={`Delete project ${project.title}`}
                  onClick={() => deleteProjectMutation.mutate(project)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Delete
                </button>
              </div>
            )
          )}
        </div>
        <form className="compact-form" onSubmit={submitProject}>
          <label htmlFor="project-title">Project title</label>
          <input id="project-title" value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} />
          <button type="submit">
            <Plus size={16} aria-hidden="true" />
            Add project
          </button>
        </form>
        <button type="button" className="sidebar-export btn btn-success" onClick={exportZip}>
          <Archive size={16} aria-hidden="true" />
          Export all ZIP
        </button>
        <button type="button" className="sidebar-export btn btn-outline-success" onClick={exportMarkdown}>
          Export all markdown
        </button>
        <button
          type="button"
          className="sidebar-export btn btn-outline-secondary"
          onClick={() => setMarkdownModal(Object.freeze({ title: "All tasks", markdown: allMarkdown }))}
        >
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
              <Plus size={16} aria-hidden="true" />
              Add task
            </button>
          </div>
        </form>

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
            <form className="compact-form inline" onSubmit={submitSection}>
              <label htmlFor="section-title">Section title</label>
              <input id="section-title" value={sectionTitle} onChange={(event) => setSectionTitle(event.target.value)} />
              <button type="submit">
                <Plus size={16} aria-hidden="true" />
                Add section
              </button>
            </form>
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
                            onClick={() => deleteSectionMutation.mutate(section)}
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
    </main>
    </DndContext>
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
      <main className="shell app-layout">
        <aside className="sidebar card shadow-sm" aria-label="Navigation">
          <div className="sidebar-brand">
            <span className="brand-mark">T</span>
            <strong>Todoist Clonse</strong>
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
          <strong>Todoist Clonse</strong>
        </div>
        <a className="nav-button nav-link-button" href="/">
          <Inbox size={16} aria-hidden="true" />
          Inbox
        </a>
        <a className="nav-button nav-link-button active" href="/tools">
          <Code2 size={16} aria-hidden="true" />
          Tools
        </a>
      </aside>
      <section className="workspace card shadow-sm tools-panel" aria-label="Database tools">
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
