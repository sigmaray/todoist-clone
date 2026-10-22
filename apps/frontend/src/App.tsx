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
import { Archive, CalendarDays, ClipboardCopy, Code2, Copy, Database, Download, Edit3, Eye, Inbox, KeyRound, MoreHorizontal, Plus, Search, Settings, Tag, Trash2, X } from "lucide-react";
import type { DragEvent, FormEvent, KeyboardEvent, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./vendor/bootstrap.min.css";
import { createTaskApi, createToolsApi } from "./api";
import type { AppSettings, ApplicationApi, ToolsApi } from "./api";
import "./App.css";

const taskQueryKey = Object.freeze(["tasks"]);
const projectQueryKey = Object.freeze(["projects"]);
const sectionQueryKey = Object.freeze(["sections"]);
const inboxDescriptionQueryKey = Object.freeze(["inbox-description"]);
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

type AutoGrowTextareaProps = Readonly<{
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  id?: string;
  placeholder?: string;
  autoFocus?: boolean;
  required?: boolean;
  className?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}>;

const AutoGrowTextarea = ({ value, onChange, ariaLabel, id, placeholder, autoFocus, required, className, onKeyDown }: AutoGrowTextareaProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  useEffect(resize, [value]);
  return <textarea ref={textareaRef} id={id} aria-label={ariaLabel} autoFocus={autoFocus} required={required} className={className} placeholder={placeholder} rows={1} value={value} onChange={(event) => { onChange(event.target.value); resize(); }} onInput={resize} onKeyDown={onKeyDown} />;
};

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
              onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); actions.cancelEdit(); } }}
              onSubmit={(event) => {
                event.preventDefault();
                actions.submitEdit(task);
              }}
            >
              <label>
                Title
                <AutoGrowTextarea
                  ariaLabel={`Edit ${task.title}`}
                  autoFocus
                  value={actions.editTitle}
                  onChange={actions.setEditTitle}
                  onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); actions.submitEdit(task); } }}
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
            <><button type="button" className={task.completed ? "task-title completed" : "task-title"} onClick={() => actions.openDetails(task)}>{task.title}</button>{task.dueDate || task.labels.length > 0 ? <span className="task-meta-list">{task.dueDate ? <time dateTime={task.dueDate} title={`Due ${task.dueDate}`}>{task.dueDate}</time> : null}{task.labels.map((label) => <a className="task-label" key={label} href={`/labels?label=${encodeURIComponent(label)}`}>{label}</a>)}</span> : null}</>
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
            <AutoGrowTextarea
              id={`subtask-${task.id}`}
              ariaLabel={`Subtask for ${task.title}`}
              autoFocus
              value={actions.subtaskTitle}
              onChange={actions.setSubtaskTitle}
              placeholder="Add a subtask"
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); actions.submitSubtask(task); } }}
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

const parsePlacement = (placement: string, sections: ReadonlyArray<Section>): Readonly<{ projectId: ProjectId | null; sectionId: SectionId | null }> => {
  if (placement.startsWith("project:")) {
    return Object.freeze({ projectId: placement.slice("project:".length), sectionId: null });
  }

  if (placement.startsWith("section:")) {
    const sectionId = placement.slice("section:".length);
    return Object.freeze({ projectId: sections.find((section) => section.id === sectionId)?.projectId ?? null, sectionId });
  }

  return Object.freeze({ projectId: null, sectionId: null });
};

const createPlacementOptions = (
  projects: ReadonlyArray<Project>,
  sections: ReadonlyArray<Section>
): ReadonlyArray<Readonly<{ value: string; label: string }>> =>
  Object.freeze([
    Object.freeze({ value: inboxPlacement, label: "Inbox" }),
    ...sections.map((section) => {
      const projectTitle = section.projectId === null ? "Inbox" : projects.find((project) => project.id === section.projectId)?.title ?? "Project";
      return Object.freeze({ value: sectionPlacement(section.id), label: `${projectTitle} / ${section.title}` });
    }),
    ...projects.map((project) => Object.freeze({ value: projectPlacement(project.id), label: project.title }))
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

const replaceById = <TItem extends Readonly<{ id: string }>>(
  items: ReadonlyArray<TItem> | undefined,
  item: TItem
): ReadonlyArray<TItem> => Object.freeze((items ?? Object.freeze([])).map((existing) => existing.id === item.id ? item : existing));

const findTaskNode = (tasks: ReadonlyArray<TaskNode>, id: string): TaskNode | null =>
  tasks.reduce<TaskNode | null>(
    (found, task) => found ?? (task.id === id ? task : findTaskNode(task.children, id)),
    null
  );

const filterTaskTree = (tasks: ReadonlyArray<TaskNode>, predicate: (task: TaskNode) => boolean): ReadonlyArray<TaskNode> =>
  Object.freeze(tasks.flatMap((task) => {
    if (predicate(task)) return [task];
    return filterTaskTree(task.children, predicate);
  }));

const flattenTaskNodes = (tasks: ReadonlyArray<TaskNode>): ReadonlyArray<Task> =>
  Object.freeze(tasks.flatMap((task) => [task, ...flattenTaskNodes(task.children)]));

const toLocalIsoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const getDateShortcut = (shortcut: "Today" | "Tomorrow" | "This weekend" | "Next week") => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  if (shortcut === "Tomorrow") date.setDate(date.getDate() + 1);
  if (shortcut === "This weekend") date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7));
  if (shortcut === "Next week") date.setDate(date.getDate() + ((8 - date.getDay()) % 7 || 7));
  return toLocalIsoDate(date);
};

const DatePickerPanel = ({ value, onChange, inputLabel }: Readonly<{ value: string; onChange: (value: string) => void; inputLabel: string }>) => {
  const [month, setMonth] = useState(() => (value || getDateShortcut("Today")).slice(0, 7));
  const today = toLocalIsoDate(new Date());
  useEffect(() => { if (value) setMonth(value.slice(0, 7)); }, [value]);
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const monthDate = new Date(Date.UTC(year, monthNumber - 1, 1));
  const monthLabel = monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const firstDayOffset = (monthDate.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cellCount = Math.ceil((firstDayOffset + daysInMonth) / 7) * 7;
  const days = Array.from({ length: cellCount }, (_, index) => {
    const day = index - firstDayOffset + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });
  const shiftMonth = (amount: number) => {
    const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
    setMonth(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const formatDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return <div className="date-picker-panel">
    <nav className="task-date-quick-links" aria-label="Quick dates">
      {(["Today", "Tomorrow", "This weekend", "Next week"] as const).map((shortcut) => <button type="button" key={shortcut} onClick={() => onChange(getDateShortcut(shortcut))}>{shortcut}</button>)}
    </nav>
    <label className="date-picker-input">Date<input type="date" aria-label={inputLabel} value={value} onChange={(event) => onChange(event.target.value)} /></label>
    <div className="date-picker-calendar">
      <header><button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)}>‹</button><strong>{monthLabel}</strong><button type="button" aria-label="Next month" onClick={() => shiftMonth(1)}>›</button></header>
      <div className="date-picker-grid" role="grid" aria-label={monthLabel}>
        {dayLabels.map((label) => <span className="date-picker-weekday" role="columnheader" key={label}>{label}</span>)}
        {days.map((day, index) => {
          if (day === null) return <span role="gridcell" aria-hidden="true" className="date-picker-empty" key={`empty-${index}`} />;
          const date = `${month}-${String(day).padStart(2, "0")}`;
          return <span role="gridcell" key={date}><button type="button" aria-label={`Choose date ${formatDate(date)}`} aria-current={today === date ? "date" : undefined} aria-pressed={value === date} className={clsx(value === date && "selected", today === date && "today")} onClick={() => onChange(date)}>{day}</button></span>;
        })}
      </div>
    </div>
  </div>;
};

const SearchPalette = ({ tasks, projects = Object.freeze([]), sections = Object.freeze([]), onTaskSelect }: Readonly<{ tasks: ReadonlyArray<Task>; projects?: ReadonlyArray<Project>; sections?: ReadonlyArray<Section>; onTaskSelect: (task: Task) => void }>) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const taskResults = normalizedQuery.length === 0 ? Object.freeze([]) : tasks.filter((task) =>
    [task.title, task.description, ...task.labels].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  );
  const labels = Array.from(new Set(tasks.flatMap((task) => task.labels)))
    .filter((label) => normalizedQuery.length > 0 && label.toLocaleLowerCase().includes(normalizedQuery));
  const projectResults = projects.filter((project) => normalizedQuery.length > 0 && project.title.toLocaleLowerCase().includes(normalizedQuery));
  const sectionResults = sections.filter((section) => normalizedQuery.length > 0 && section.title.toLocaleLowerCase().includes(normalizedQuery));

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);

  return <>
    <button type="button" className="nav-button search-nav-button" onClick={() => setOpen(true)}><Search size={16} aria-hidden="true" />Search <kbd>Ctrl K</kbd></button>
    {open ? createPortal(
      <div className="search-palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section className="search-palette" role="dialog" aria-modal="true" aria-label="Search">
          <div className="search-palette-input"><Search size={20} aria-hidden="true" /><input ref={inputRef} aria-label="Search or type a command" placeholder="Search tasks, labels, or go to…" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>Ctrl</kbd><kbd>K</kbd></div>
          {normalizedQuery ? <div className="search-palette-results">
            {taskResults.length ? <><h2>Tasks</h2>{taskResults.slice(0, 30).map((task) => <button className="search-result" type="button" key={task.id} onClick={() => { onTaskSelect(task); setOpen(false); }}><span className="search-result-icon">○</span><span className="search-result-main"><strong>{task.title}</strong>{task.description ? <small>{task.description}</small> : null}</span>{task.labels.length ? <small>{task.labels.map((label) => `#${label}`).join(" ")}</small> : null}</button>)}</> : null}
            {labels.length ? <><h2>Labels</h2>{labels.map((label) => <a className="search-result" key={label} href={`/labels?label=${encodeURIComponent(label)}`} onClick={() => setOpen(false)}><span className="search-result-icon">◇</span><strong>{label}</strong></a>)}</> : null}
            {projectResults.length ? <><h2>Projects</h2>{projectResults.map((project) => <a className="search-result" key={project.id} href={`/?project=${encodeURIComponent(project.id)}`} onClick={() => setOpen(false)}><span className="search-result-icon">#</span><strong>{project.title}</strong></a>)}</> : null}
            {sectionResults.length ? <><h2>Sections</h2>{sectionResults.map((section) => <a className="search-result" key={section.id} href={section.projectId ? `/?project=${encodeURIComponent(section.projectId)}` : "/"} onClick={() => setOpen(false)}><span className="search-result-icon">☷</span><strong>{section.title}</strong></a>)}</> : null}
            {!taskResults.length && !labels.length && !projectResults.length && !sectionResults.length ? <p className="search-empty">No matching tasks, labels, projects, or sections.</p> : null}
          </div> : <div className="search-palette-navigation"><h2>Navigation</h2>{[{ label: "Go to Inbox", href: "/" }, { label: "Go to Dates", href: "/dates" }, { label: "Go to Labels", href: "/labels" }].map((item) => <a className="search-result" key={item.href} href={item.href} onClick={() => setOpen(false)}><span className="search-result-icon">⌂</span><strong>{item.label}</strong></a>)}</div>}
        </section>
      </div>,
      document.body
    ) : null}
  </>;
};

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

const currentMarkdown = (
  title: string,
  inboxRootTasks: ReadonlyArray<TaskNode>,
  sections: ReadonlyArray<Section>,
  allTasks: ReadonlyArray<TaskNode>,
  targetProjectId: ProjectId | null
) => {
  if (targetProjectId !== null) {
    return renderTaskMarkdownDocument(
      title,
      allTasks.filter((task) => task.projectId === targetProjectId && task.sectionId === null),
      sections.filter((section) => section.projectId === targetProjectId).map((section) => Object.freeze({
        title: section.title,
        tasks: allTasks.filter((task) => task.projectId === targetProjectId && task.sectionId === section.id)
      }))
    );
  }

  return renderTaskMarkdownDocument(
    "Inbox",
    inboxRootTasks,
    sections.filter((section) => section.projectId === null).map((section) => Object.freeze({
      title: section.title,
      tasks: allTasks.filter((task) => task.projectId === null && task.sectionId === section.id)
    }))
  );
};

const allMarkdownDocument = (
  projects: ReadonlyArray<Project>,
  sections: ReadonlyArray<Section>,
  tasks: ReadonlyArray<TaskNode>
) => renderTaskMarkdownDocument("All tasks", [], [
  Object.freeze({ title: "Inbox", tasks: tasks.filter((task) => task.projectId === null && task.sectionId === null) }),
  ...sections.filter((section) => section.projectId === null).map((section) => Object.freeze({
    title: `Inbox / ${section.title}`,
    tasks: tasks.filter((task) => task.projectId === null && task.sectionId === section.id)
  })),
  ...projects.flatMap((project) => [
    Object.freeze({ title: project.title, tasks: tasks.filter((task) => task.projectId === project.id && task.sectionId === null) }),
    ...sections.filter((section) => section.projectId === project.id).map((section) => Object.freeze({
      title: `${project.title} / ${section.title}`,
      tasks: tasks.filter((task) => task.projectId === project.id && task.sectionId === section.id)
    }))
  ])
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
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [dateView, setDateView] = useState<"list" | "calendar">("list");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [activeCalendarDate, setActiveCalendarDate] = useState<string | null>(null);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [addTaskTitle, setAddTaskTitle] = useState("");
  const [addTaskDescription, setAddTaskDescription] = useState("");
  const [addTaskDate, setAddTaskDate] = useState("");
  const [addTaskDatePickerOpen, setAddTaskDatePickerOpen] = useState(false);
  const [addTaskDateBeforePicker, setAddTaskDateBeforePicker] = useState("");
  const [addTaskLabels, setAddTaskLabels] = useState("");
  const [addTaskPlacement, setAddTaskPlacement] = useState(inboxPlacement);
  const [title, setTitle] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [addingProject, setAddingProject] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  const [editProjectId, setEditProjectId] = useState<ProjectId | null>(null);
  const [editProjectTitle, setEditProjectTitle] = useState("");
  const [editSectionId, setEditSectionId] = useState<SectionId | null>(null);
  const [editSectionTitle, setEditSectionTitle] = useState("");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskParentId, setSubtaskParentId] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [activeDragTarget, setActiveDragTarget] = useState<ActiveDragTarget | null>(null);
  const [activeDropZone, setActiveDropZone] = useState<DropZoneId | null>(null);
  const [activeProjectDrop, setActiveProjectDrop] = useState<Readonly<{ id: ProjectId; position: "before" | "after" }> | null>(null);
  const [draggingProjectId, setDraggingProjectId] = useState<ProjectId | null>(null);
  const [activeSectionDrop, setActiveSectionDrop] = useState<Readonly<{ id: SectionId; position: "before" | "after" }> | null>(null);
  const [draggingSectionId, setDraggingSectionId] = useState<SectionId | null>(null);
  const [targetProjectId, setTargetProjectId] = useState<ProjectId | null>(() => new URLSearchParams(window.location.search).get("project"));
  const [targetSectionId, setTargetSectionId] = useState<SectionId | null>(null);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPlacement, setEditPlacement] = useState(inboxPlacement);
  const [markdownModal, setMarkdownModal] = useState<Readonly<{ title: string; markdown: string; format?: "markdown" | "json" }> | null>(null);
  const [scopeExportOpen, setScopeExportOpen] = useState(false);
  const [detailsTaskId, setDetailsTaskId] = useState<TaskId | null>(null);
  const [detailTitle, setDetailTitle] = useState("");
  const [detailDescription, setDetailDescription] = useState("");
  const [detailDueDate, setDetailDueDate] = useState("");
  const [detailLabels, setDetailLabels] = useState("");
  const [detailLabelInput, setDetailLabelInput] = useState("");
  const [detailSaveStatus, setDetailSaveStatus] = useState("");
  const [detailProjectId, setDetailProjectId] = useState<ProjectId | null>(null);
  const [editingDetailField, setEditingDetailField] = useState<"title" | "description" | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const projectCreateInputRef = useRef<HTMLInputElement>(null);
  const sectionCreateInputRef = useRef<HTMLInputElement>(null);
  const [detailComment, setDetailComment] = useState("");
  const [detailSubtask, setDetailSubtask] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const [openProjectMenuId, setOpenProjectMenuId] = useState<ProjectId | null>(null);
  const [editingScopeDescription, setEditingScopeDescription] = useState(false);
  const [scopeDescriptionDraft, setScopeDescriptionDraft] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const queryClient = useQueryClient();
  const markdownFloating = useFloating({ open: markdownModal !== null });
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: Object.freeze({ distance: 4 }) }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => { const syncPath = () => setCurrentPath(window.location.pathname); window.addEventListener("popstate", syncPath); return () => window.removeEventListener("popstate", syncPath); }, []);
  useEffect(() => { if (addingProject) projectCreateInputRef.current?.focus(); }, [addingProject]);
  useEffect(() => { if (addingSection) sectionCreateInputRef.current?.focus(); }, [addingSection]);
  useEffect(() => {
    if (openProjectMenuId === null) return;
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".project-menu") === null) setOpenProjectMenuId(null);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpenProjectMenuId(null); };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [openProjectMenuId]);
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && scopeExportOpen && markdownModal === null) setScopeExportOpen(false);
      if (event.key === "Escape" && detailsTaskId !== null && editingDetailField === null && !datePickerOpen && detailLabelInput === "") setDetailsTaskId(null);
      const target = event.target;
      const isTyping = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (!isTyping && detailsTaskId === null && markdownModal === null && !scopeExportOpen && !addTaskOpen && !event.ctrlKey && !event.metaKey && !event.altKey && ["q", "й"].includes(event.key.toLocaleLowerCase())) {
        event.preventDefault();
        setAddTaskPlacement(currentPath === "/" ? (targetSectionId === null ? targetProjectId === null ? inboxPlacement : projectPlacement(targetProjectId) : sectionPlacement(targetSectionId)) : inboxPlacement);
        setAddTaskPlacement(currentPath === "/" ? (targetSectionId === null ? targetProjectId === null ? inboxPlacement : projectPlacement(targetProjectId) : sectionPlacement(targetSectionId)) : inboxPlacement);
        setAddTaskTitle(""); setAddTaskDescription(""); setAddTaskDate(""); setAddTaskLabels(""); setAddTaskOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailsTaskId, markdownModal, scopeExportOpen, addTaskOpen, editingDetailField, datePickerOpen, detailLabelInput, targetProjectId, targetSectionId, currentPath]);
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
  const inboxDescriptionQuery = useQuery({ queryKey: inboxDescriptionQueryKey, queryFn: api.getInboxDescription });

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
      setAddingProject(false);
      setTargetProjectId(project.id);
      setTargetSectionId(null);
      window.history.pushState({}, "", `/?project=${encodeURIComponent(project.id)}`);
      setCurrentPath("/");
      queryClient.setQueryData(projectQueryKey, (current: ReadonlyArray<Project> | undefined) => appendById(current, project));
    }
  });

  const updateProjectMutation = useMutation({
    mutationFn: (project: Readonly<{ id: ProjectId; title?: string; description?: string }>) => api.updateProject(project.id, project),
    onSuccess: (project) => {
      setEditProjectId(null);
      setEditProjectTitle("");
      queryClient.setQueryData(projectQueryKey, (current: ReadonlyArray<Project> | undefined) => replaceById(current, project));
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
  const archiveProjectMutation = useMutation({ mutationFn: ({ id, archived }: Readonly<{ id: ProjectId; archived: boolean }>) => api.archiveProject(id, archived), onSuccess: (project) => queryClient.setQueryData(projectQueryKey, (current: ReadonlyArray<Project> | undefined) => replaceById(current, project)) });

  const reorderProjectMutation = useMutation({ mutationFn: ({ id, beforeId, afterId }: Readonly<{ id: ProjectId; beforeId: ProjectId | null; afterId: ProjectId | null }>) => api.reorderProject(id, beforeId, afterId), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: projectQueryKey }); } });
  const reorderSectionMutation = useMutation({ mutationFn: ({ id, beforeId, afterId }: Readonly<{ id: SectionId; beforeId: SectionId | null; afterId: SectionId | null }>) => api.reorderSection(id, beforeId, afterId), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: sectionQueryKey }); } });

  const requestProjectDelete = (project: Project) => {
    if (confirmDeletion(`Delete project “${project.title}” and all its tasks?`)) {
      deleteProjectMutation.mutate(project);
    }
  };

  const createSectionMutation = useMutation({
    mutationFn: (input: Readonly<{ title: string; projectId: ProjectId | null }>) => api.createSection(input.title, input.projectId),
    onSuccess: (section) => {
      setSectionTitle("");
      setAddingSection(false);
      queryClient.setQueryData(sectionQueryKey, (current: ReadonlyArray<Section> | undefined) => appendById(current, section));
    }
  });

  const updateSectionMutation = useMutation({
    mutationFn: (section: Readonly<{ id: SectionId; title: string }>) => api.updateSection(section.id, section.title),
    onSuccess: (section) => {
      setEditSectionId(null);
      setEditSectionTitle("");
      queryClient.setQueryData(sectionQueryKey, (current: ReadonlyArray<Section> | undefined) => replaceById(current, section));
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
      const placement = parsePlacement(editPlacement, allSections);
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

  const cancelProjectCreate = () => { setAddingProject(false); setProjectTitle(""); };

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
      createSectionMutation.mutate({ title: trimmed, projectId: targetProjectId });
    }
  };

  const cancelSectionCreate = () => { setAddingSection(false); setSectionTitle(""); };

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
    if (event.dataTransfer?.types && !event.dataTransfer.types.includes("text/task-id")) return;
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

  const startSectionDrag = (section: Section) => (event: DragEvent<HTMLElement>) => {
    setDraggingSectionId(section.id);
    event.dataTransfer.setData("application/x-section-id", section.id);
    event.dataTransfer.effectAllowed = "move";
  };
  const markSectionDrop = (section: Section) => (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("application/x-section-id")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setActiveSectionDrop(Object.freeze({ id: section.id, position: event.clientY < rect.top + rect.height / 2 ? "before" : "after" }));
  };
  const dropSection = (section: Section, siblings: ReadonlyArray<Section>) => (event: DragEvent<HTMLElement>) => {
    const draggedId = event.dataTransfer.getData("application/x-section-id");
    if (!draggedId || draggedId === section.id) return;
    event.preventDefault();
    const position = event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2 ? "before" : "after";
    const ordered = siblings.filter((item) => item.id !== draggedId);
    const index = ordered.findIndex((item) => item.id === section.id);
    const beforeId = position === "before" ? section.id : ordered[index + 1]?.id ?? null;
    const afterId = position === "before" ? ordered[index - 1]?.id ?? null : section.id;
    setDraggingSectionId(null); setActiveSectionDrop(null);
    reorderSectionMutation.mutate({ id: draggedId, beforeId, afterId });
  };
  const markProjectDrop = (project: Project) => (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("application/x-project-id")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setActiveProjectDrop(Object.freeze({ id: project.id, position: event.clientY < rect.top + rect.height / 2 ? "before" : "after" }));
  };
  const dropProject = (project: Project) => (event: DragEvent<HTMLElement>) => {
    const draggedId = event.dataTransfer.getData("application/x-project-id");
    if (!draggedId || draggedId === project.id) return;
    event.preventDefault();
    const position = event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2 ? "before" : "after";
    const ordered = activeProjects.filter((item) => item.id !== draggedId);
    const index = ordered.findIndex((item) => item.id === project.id);
    const beforeId = position === "before" ? project.id : ordered[index + 1]?.id ?? null;
    const afterId = position === "before" ? ordered[index - 1]?.id ?? null : project.id;
    setActiveProjectDrop(null);
    setDraggingProjectId(null);
    setActiveDropZone(null);
    reorderProjectMutation.mutate({ id: draggedId, beforeId, afterId });
  };
  const dropTaskOnCalendarDate = (date: string) => (event: DragEvent<HTMLElement>) => {
    const taskId = event.dataTransfer.getData("text/task-id");
    if (!taskId) return;
    event.preventDefault();
    setActiveCalendarDate(null);
    setActiveDropZone(null);
    void api.updateTask(taskId, { dueDate: date }).then(() => queryClient.invalidateQueries({ queryKey: taskQueryKey }));
  };
  const markCalendarDate = (date: string) => (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("text/task-id")) return;
    event.preventDefault();
    setActiveCalendarDate(date);
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
    setDetailLabelInput("");
    setDetailSaveStatus("");
    setDetailProjectId(task.projectId);
    setEditingDetailField(null);
    setDatePickerOpen(false);
  };

  const submitEdit = (task: TaskNode) => {
    if (editTitle.trim().length === 0) {
      return;
    }

    editMutation.mutate(task);
  };

  const allTasks = tasks.data ?? Object.freeze([]);
  const flatTasks = flattenTaskNodes(allTasks);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("addTask") === "1") { setAddTaskPlacement(targetProjectId === null ? inboxPlacement : projectPlacement(targetProjectId)); setAddTaskOpen(true); window.history.replaceState({}, "", window.location.pathname); }
    const taskId = new URLSearchParams(window.location.search).get("task");
    const task = taskId === null ? null : findTaskNode(allTasks, taskId);
    if (task !== null) {
      openDetails(task);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [allTasks, targetProjectId]);
  const allProjects = projects.data ?? Object.freeze([]);
  const activeProjects = allProjects.filter((project) => !project.archived);
  const allSections = sections.data ?? Object.freeze([]);
  const selectedDetailsTask = detailsTaskId === null ? null : findTaskNode(allTasks, detailsTaskId);
  const selectedDetailsProject = detailProjectId === null
    ? null
    : allProjects.find((project) => project.id === detailProjectId) ?? null;
  const selectedDetailsSection = selectedDetailsTask?.sectionId === null || selectedDetailsTask?.sectionId === undefined
    ? null
    : allSections.find((section) => section.id === selectedDetailsTask.sectionId) ?? null;
  const selectedDetailsParent = selectedDetailsTask?.parentId === null || selectedDetailsTask?.parentId === undefined
    ? null
    : findTaskNode(allTasks, selectedDetailsTask.parentId);
  const saveTaskDetails = async (patch: Parameters<ApplicationApi["updateTask"]>[1]): Promise<boolean> => {
    if (selectedDetailsTask === null) return false;
    setDetailSaveStatus("Saving…");
    try {
      const updatedTask = await api.updateTask(selectedDetailsTask.id, patch);
      queryClient.setQueryData<ReadonlyArray<TaskNode>>(taskQueryKey, (current) => {
        if (current === undefined) return current;
        const updateNode = (node: TaskNode): TaskNode => node.id === updatedTask.id
          ? Object.freeze({ ...node, ...updatedTask, children: node.children })
          : Object.freeze({ ...node, children: node.children.map(updateNode) });
        return current.map(updateNode);
      });
      setDetailSaveStatus("Saved");
      return true;
    } catch {
      setDetailSaveStatus("Could not save changes");
      return false;
    }
  };
  const inboxSections = allSections.filter((section) => section.projectId === null);
  const projectSections = allSections.filter((section) => section.projectId === targetProjectId && targetProjectId !== null);
  const inboxRootTasks = allTasks.filter((task) => task.projectId === null && task.sectionId === null);
  const currentScopeDescription = targetProjectId === null ? inboxDescriptionQuery.data ?? "" : activeProjects.find((project) => project.id === targetProjectId)?.description ?? "";
  const startScopeDescriptionEdit = () => { setScopeDescriptionDraft(currentScopeDescription); setEditingScopeDescription(true); };
  const saveScopeDescription = async () => {
    const description = scopeDescriptionDraft.trim();
    if (targetProjectId === null) {
      await api.updateInboxDescription(description);
      await queryClient.invalidateQueries({ queryKey: inboxDescriptionQueryKey });
    } else {
      updateProjectMutation.mutate({ id: targetProjectId, description });
    }
    setEditingScopeDescription(false);
  };
  const removeScopeDescription = async () => {
    if (!confirmDeletion("Delete this description?")) return;
    if (targetProjectId === null) {
      await api.updateInboxDescription("");
      await queryClient.invalidateQueries({ queryKey: inboxDescriptionQueryKey });
    } else {
      updateProjectMutation.mutate({ id: targetProjectId, description: "" });
    }
  };
  const scopeDescriptionBlock = editingScopeDescription ? <section className="scope-description-editor" aria-label="Description editor"><h2>Description</h2><AutoGrowTextarea ariaLabel="Scope description" autoFocus value={scopeDescriptionDraft} onChange={setScopeDescriptionDraft} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditingScopeDescription(false); } }} /><div><button type="button" className="btn-primary" onClick={() => void saveScopeDescription()}>Save</button><button type="button" onClick={() => setEditingScopeDescription(false)}>Cancel</button></div></section> : currentScopeDescription ? <section className="scope-description" aria-labelledby="scope-description-title"><div><h2 id="scope-description-title">Description</h2><div><button type="button" aria-label="Edit description" onClick={startScopeDescriptionEdit}><Edit3 size={14} aria-hidden="true" />Edit</button><button type="button" aria-label="Delete description" className="danger" onClick={() => void removeScopeDescription()}><Trash2 size={14} aria-hidden="true" />Delete</button></div></div><p>{currentScopeDescription}</p></section> : <button type="button" className="add-description-trigger" onClick={startScopeDescriptionEdit}><Plus size={15} aria-hidden="true" />Add description</button>;

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
      ? allSections.find((section) => section.id === targetSectionId)?.title ?? "selected section"
      : targetProjectId !== null
        ? allProjects.find((project) => project.id === targetProjectId)?.title ?? "selected project"
        : "Inbox";
  const pageMode = currentPath === "/dates" ? "dates" : currentPath === "/labels" ? "labels" : currentPath === "/export" ? "export" : "tasks";
  const selectedLabel = new URLSearchParams(window.location.search).get("label") ?? "";
  const viewTasks = pageMode === "dates"
    ? filterTaskTree(allTasks, (task) => Boolean(task.dueDate))
    : filterTaskTree(allTasks, (task) => task.labels.length > 0 && (!selectedLabel || task.labels.includes(selectedLabel)));
  const viewTitle = pageMode === "dates" ? "Dates" : pageMode === "labels" ? (selectedLabel ? `Label: ${selectedLabel}` : "Labels") : pageMode === "export" ? "Export" : targetProjectId === null ? "Inbox" : taskTargetLabel;
  const markdown = currentMarkdown(taskTargetLabel, inboxRootTasks, allSections, allTasks, targetProjectId);
  const openAddTaskDialog = (placement: string) => {
    setAddTaskPlacement(placement);
    setAddTaskTitle("");
    setAddTaskDescription("");
    setAddTaskDate("");
    setAddTaskLabels("");
    setAddTaskOpen(true);
  };
  const deleteAllTasks = async () => {
    const roots = flatTasks.filter((task) => task.parentId === null && task.projectId === targetProjectId);
    if (roots.length === 0) return;
    const scope = targetProjectId === null ? "Inbox" : allProjects.find((project) => project.id === targetProjectId)?.title ?? "this project";
    if (!confirmDeletion(`Delete all ${roots.length} top-level tasks in ${scope}, including their subtasks?`)) return;
    await Promise.all(roots.map((task) => api.deleteTask(task.id)));
    await queryClient.invalidateQueries({ queryKey: taskQueryKey });
  };

  const finishDndDrag = (_event: DragEndEvent) => {
    setDraggingTaskId(null);
    setActiveDragTarget(null);
    setActiveDropZone(null);
  };

  const allMarkdown = allMarkdownDocument(allProjects, allSections, allTasks);
  const allJson = JSON.stringify(Object.freeze({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    inbox: Object.freeze({
      description: inboxDescriptionQuery.data ?? "",
      sections: allSections.filter((section) => section.projectId === null),
      tasks: flatTasks.filter((task) => task.projectId === null)
    }),
    projects: allProjects.map((project) => Object.freeze({
      ...project,
      sections: allSections.filter((section) => section.projectId === project.id),
      tasks: flatTasks.filter((task) => task.projectId === project.id)
    })),
    sections: allSections,
    tasks: flatTasks,
    taskTree: allTasks,
    dates: flatTasks.filter((task) => task.dueDate !== null).map((task) => Object.freeze({ taskId: task.id, dueDate: task.dueDate })),
    comments: flatTasks.flatMap((task) => task.comments.map((comment) => Object.freeze({ ...comment, taskId: task.id }))),
    descriptions: Object.freeze({
      inbox: inboxDescriptionQuery.data ?? "",
      projects: allProjects.map((project) => Object.freeze({ id: project.id, description: project.description })),
      tasks: flatTasks.filter((task) => task.description.length > 0).map((task) => Object.freeze({ id: task.id, description: task.description }))
    })
  }), null, 2);
  const scopeProject = targetProjectId === null ? null : allProjects.find((project) => project.id === targetProjectId) ?? null;
  const scopeSections = allSections.filter((section) => section.projectId === targetProjectId);
  const scopeTasks = flatTasks.filter((task) => task.projectId === targetProjectId);
  const scopeTaskTree = filterTaskTree(allTasks, (task) => task.projectId === targetProjectId);
  const scopeDescription = targetProjectId === null ? inboxDescriptionQuery.data ?? "" : scopeProject?.description ?? "";
  const scopeJson = JSON.stringify(Object.freeze({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    scope: Object.freeze({ type: targetProjectId === null ? "inbox" : "project", id: targetProjectId, title: targetProjectId === null ? "Inbox" : scopeProject?.title ?? taskTargetLabel }),
    inbox: targetProjectId === null ? Object.freeze({ description: scopeDescription, sections: scopeSections, tasks: scopeTasks }) : null,
    project: scopeProject === null ? null : Object.freeze({ ...scopeProject, sections: scopeSections, tasks: scopeTasks }),
    sections: scopeSections,
    tasks: scopeTasks,
    taskTree: scopeTaskTree,
    dates: scopeTasks.filter((task) => task.dueDate !== null).map((task) => Object.freeze({ taskId: task.id, dueDate: task.dueDate })),
    comments: scopeTasks.flatMap((task) => task.comments.map((comment) => Object.freeze({ ...comment, taskId: task.id }))),
    descriptions: Object.freeze({
      scope: scopeDescription,
      tasks: scopeTasks.filter((task) => task.description.length > 0).map((task) => Object.freeze({ id: task.id, description: task.description }))
    })
  }), null, 2);

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
        <SearchPalette tasks={flatTasks} projects={allProjects} sections={allSections} onTaskSelect={(task) => { const node = findTaskNode(allTasks, task.id); if (node !== null) openDetails(node); }} />
        <button type="button" className="nav-button add-task-nav-button" onClick={() => openAddTaskDialog(pageMode === "tasks" ? (targetSectionId === null ? targetProjectId === null ? inboxPlacement : projectPlacement(targetProjectId) : sectionPlacement(targetSectionId)) : inboxPlacement)}><Plus size={17} aria-hidden="true" />Add task <kbd>Q</kbd></button>
        <button
          type="button"
          className={["nav-button", pageMode === "tasks" && targetProjectId === null && targetSectionId === null ? "active" : ""].filter(Boolean).join(" ")}
          onClick={() => {
            window.history.pushState({}, "", "/"); setCurrentPath("/");
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
        <a className={clsx("nav-button nav-link-button", pageMode === "dates" && "active")} href="/dates"><CalendarDays size={16} aria-hidden="true" />Dates</a>
        <a className={clsx("nav-button nav-link-button", pageMode === "labels" && "active")} href="/labels"><Tag size={16} aria-hidden="true" />Labels</a>
        <a className={clsx("nav-button nav-link-button", pageMode === "export" && "active")} href="/export"><Download size={16} aria-hidden="true" />Export</a>
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
              <form key={project.id} className="project-edit-form" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditProjectId(null); setEditProjectTitle(""); } }} onSubmit={submitProjectEdit(project)}>
                <label htmlFor={`project-edit-${project.id}`}>Project title</label>
                <input
                  id={`project-edit-${project.id}`}
                  autoFocus
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
              <div key={project.id} className={clsx("project-nav-row", draggingProjectId === project.id && "project-dragging", activeProjectDrop?.id === project.id && `project-drop-${activeProjectDrop.position}`)} draggable onDragStart={(event) => { setActiveDropZone(null); setActiveProjectDrop(null); setDraggingProjectId(project.id); event.dataTransfer.setData("application/x-project-id", project.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDraggingProjectId(null); setActiveProjectDrop(null); setActiveDropZone(null); }} onDragOver={markProjectDrop(project)} onDragLeave={() => setActiveProjectDrop(null)} onDrop={dropProject(project)}>
                <button
                  type="button"
                  className={clsx(
                    "nav-button",
                    targetProjectId === project.id && "active",
                    activeDropZone === projectPlacement(project.id) && "drop-active",
                  )}
                  onClick={() => {
                    window.history.pushState({}, "", `/?project=${encodeURIComponent(project.id)}`); setCurrentPath("/");
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
        <div className="sidebar-create-block">
          {addingProject ? <form className="inline-create-form" onSubmit={submitProject} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelProjectCreate(); } }}>
            <label htmlFor="project-title">Title</label><input ref={projectCreateInputRef} id="project-title" aria-label="Project title" value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} />
            <div><button type="submit" className="btn-primary">Save</button><button type="button" onClick={cancelProjectCreate}>Cancel</button></div>
          </form> : <button type="button" className="add-project-trigger" onClick={() => { setProjectTitle(""); setAddingProject(true); }}><Plus size={16} aria-hidden="true" />Add project</button>}
        </div>
      </aside>

      <section className="workspace card shadow-sm" aria-label="Task manager">
        <header className="header">
          <p className="eyebrow">Self-hosted MVP</p>
          <h1>{viewTitle}</h1>
          {pageMode === "tasks" ? <div className="task-header-actions">
            <button type="button" className="scope-export-trigger btn-primary" onClick={() => setScopeExportOpen(true)}><Download size={16} aria-hidden="true" />Export</button>
            <button type="button" className="btn btn-outline-danger delete-all-tasks-button" disabled={!flatTasks.some((task) => task.parentId === null && task.projectId === targetProjectId)} onClick={() => void deleteAllTasks()}><Trash2 size={15} aria-hidden="true" />Delete all tasks</button>
          </div> : null}
        </header>



        {tasks.isLoading ? <p className="muted">Loading tasks...</p> : null}
        {tasks.isError ? <p className="error">Unable to load tasks.</p> : null}
        {pageMode === "dates" || pageMode === "labels" ? (
          <section className="drop-zone task-filter-page" aria-label={`${viewTitle} tasks`}>
            {pageMode === "dates" ? <div className="date-view-switch" aria-label="Date view"><button type="button" aria-pressed={dateView === "list"} onClick={() => setDateView("list")}>List</button><button type="button" aria-pressed={dateView === "calendar"} onClick={() => setDateView("calendar")}>Calendar</button></div> : null}
            {pageMode === "labels" ? <nav className="label-filter-list" aria-label="Filter by label"><a className={!selectedLabel ? "active" : ""} href="/labels">All labels</a>{Array.from(new Set(flatTasks.flatMap((task) => task.labels))).sort().map((label) => <a key={label} className={selectedLabel === label ? "active" : ""} href={`/labels?label=${encodeURIComponent(label)}`}>{label}</a>)}</nav> : null}
            {pageMode === "dates" && dateView === "calendar" ? <><div className="calendar-month-control"><button type="button" aria-label="Previous month" onClick={() => setCalendarMonth((month) => { const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() - 1); return date.toISOString().slice(0, 7); })}>‹</button><label>Month<input aria-label="Calendar month" type="month" value={calendarMonth} onChange={(event) => setCalendarMonth(event.target.value)} /></label><button type="button" aria-label="Next month" onClick={() => setCalendarMonth((month) => { const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1); return date.toISOString().slice(0, 7); })}>›</button></div><div className="dates-calendar" aria-label="Calendar view">{Array.from({ length: new Date(Number(calendarMonth.slice(0, 4)), Number(calendarMonth.slice(5, 7)), 0).getDate() }, (_, index) => index + 1).map((day) => { const date = `${calendarMonth}-${String(day).padStart(2, "0")}`; const matching = viewTasks.filter((task) => task.dueDate === date); return <section key={day} className={clsx("dates-calendar-day", activeCalendarDate === date && "calendar-drop-active")} aria-label={`Tasks for ${date}`} onDragOver={markCalendarDate(date)} onDragLeave={() => setActiveCalendarDate(null)} onDrop={dropTaskOnCalendarDate(date)}><h2>{day}</h2>{matching.map((task) => <button type="button" key={task.id} draggable onDragStart={(event) => { setDraggingTaskId(task.id); event.dataTransfer.setData("text/task-id", task.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDraggingTaskId(null); setActiveCalendarDate(null); }} onClick={() => { const node = findTaskNode(allTasks, task.id); if (node) openDetails(node); }}>{task.title}</button>)}</section>; })}</div></> : viewTasks.length > 0 ? renderTaskNodes(viewTasks, taskActions) : <p className="empty">{pageMode === "dates" ? "No dated tasks yet." : "No tasks with this label."}</p>}
          </section>
        ) : pageMode === "export" ? (
          <section className="export-page" aria-label="Export data">
            <section className="card export-format-card" aria-labelledby="markdown-export-title">
              <div><h2 id="markdown-export-title">Markdown</h2><p>Human-readable task lists organized by Inbox, projects, and sections.</p></div>
              <div className="export-format-actions">
                <button type="button" className="btn-primary" onClick={exportMarkdown}><Download size={16} aria-hidden="true" />Export all markdown</button>
                <button type="button" onClick={async () => { await copyText(allMarkdown); setCopyStatus("All markdown copied"); }}><ClipboardCopy size={16} aria-hidden="true" />Copy all markdown</button>
                <button type="button" onClick={() => setMarkdownModal(Object.freeze({ title: "All tasks", markdown: allMarkdown, format: "markdown" }))}><Eye size={16} aria-hidden="true" />Preview all markdown</button>
              </div>
            </section>
            <section className="card export-format-card" aria-labelledby="json-export-title">
              <div><h2 id="json-export-title">JSON</h2><p>Complete structured data, including descriptions, dates, sections, task hierarchy, labels, comments, and archived projects.</p></div>
              <div className="export-format-actions">
                <button type="button" className="btn-primary" onClick={() => downloadBlob(new Blob([allJson], { type: "application/json;charset=utf-8" }), "todoist-clone.json")}><Download size={16} aria-hidden="true" />Export all JSON</button>
                <button type="button" onClick={async () => { await copyText(allJson); setCopyStatus("All JSON copied"); }}><ClipboardCopy size={16} aria-hidden="true" />Copy all JSON</button>
                <button type="button" onClick={() => setMarkdownModal(Object.freeze({ title: "All data", markdown: allJson, format: "json" }))}><Eye size={16} aria-hidden="true" />Preview all JSON</button>
              </div>
            </section>
            {copyStatus.length > 0 ? <p className="muted" role="status">{copyStatus}</p> : null}
          </section>
        ) : targetProjectId === null ? (
          <div className="board">
            {scopeDescriptionBlock}
            <section
              className={clsx("drop-zone", activeDropZone === "inbox" && "drop-active")}
              onDragEnter={markDropZone(null, null)}
              onDragOver={markDropZone(null, null)}
              onDragLeave={() => setActiveDropZone(null)}
              onDrop={moveDroppedTask(null, null)}
              aria-label="Inbox tasks"
            >
              <div className="task-scope-heading"><h2>Inbox</h2><button type="button" className="scope-add-task-button" aria-label="Add task to Inbox" onClick={() => openAddTaskDialog(inboxPlacement)}><Plus size={16} aria-hidden="true" />Add task</button></div>
              {inboxRootTasks.length > 0 ? renderTaskNodes(inboxRootTasks, taskActions) : <p className="empty">No inbox tasks yet.</p>}
            </section>
            <div className="section-create-block">
              {addingSection ? <form className="inline-create-form" onSubmit={submitSection} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelSectionCreate(); } }}>
                <label htmlFor="section-title">Title</label><input ref={sectionCreateInputRef} id="section-title" aria-label="Section title" value={sectionTitle} onChange={(event) => setSectionTitle(event.target.value)} />
                <div><button type="submit" className="btn-primary">Save</button><button type="button" onClick={cancelSectionCreate}>Cancel</button></div>
              </form> : <button type="button" className="add-section-trigger" onClick={() => { setSectionTitle(""); setAddingSection(true); }}><Plus size={16} aria-hidden="true" />Add section</button>}
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
                  <div className={clsx("section-header", draggingSectionId === section.id && "section-dragging", activeSectionDrop?.id === section.id && `section-drop-${activeSectionDrop.position}`)} draggable={editSectionId !== section.id} onDragStart={startSectionDrag(section)} onDragEnd={() => { setDraggingSectionId(null); setActiveSectionDrop(null); }} onDragOver={markSectionDrop(section)} onDragLeave={() => setActiveSectionDrop(null)} onDrop={dropSection(section, inboxSections)}>
                    {editSectionId === section.id ? (
                      <form className="section-edit-form" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditSectionId(null); setEditSectionTitle(""); } }} onSubmit={submitSectionEdit(section)}>
                        <label htmlFor={`section-edit-${section.id}`}>Section title</label>
                        <input
                          id={`section-edit-${section.id}`}
                          autoFocus
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
                          <button type="button" aria-label={`Add task to section ${section.title}`} onClick={() => openAddTaskDialog(sectionPlacement(section.id))}><Plus size={14} aria-hidden="true" />Add task</button>
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
          <div className="board">
            {scopeDescriptionBlock}
            <section
              className={clsx("drop-zone", activeDropZone === projectPlacement(targetProjectId) && "drop-active")}
              onDragEnter={markDropZone(targetProjectId, null)}
              onDragOver={markDropZone(targetProjectId, null)}
              onDragLeave={() => setActiveDropZone(null)}
              onDrop={moveDroppedTask(targetProjectId, null)}
              aria-label={`${taskTargetLabel} tasks`}
            >
            <div className="task-scope-heading project-task-scope-heading"><button type="button" className="scope-add-task-button" aria-label={`Add task to ${taskTargetLabel}`} onClick={() => openAddTaskDialog(projectPlacement(targetProjectId))}><Plus size={16} aria-hidden="true" />Add task</button></div>
            {allTasks.filter((task) => task.projectId === targetProjectId && task.sectionId === null).length > 0
                ? renderTaskNodes(allTasks.filter((task) => task.projectId === targetProjectId && task.sectionId === null), taskActions)
                : <p className="empty">No project tasks yet.</p>}
            </section>
            <div className="section-create-block">
              {addingSection ? <form className="inline-create-form" onSubmit={submitSection} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelSectionCreate(); } }}>
                <label htmlFor="section-title">Title</label><input ref={sectionCreateInputRef} id="section-title" aria-label="Section title" value={sectionTitle} onChange={(event) => setSectionTitle(event.target.value)} />
                <div><button type="submit" className="btn-primary">Save</button><button type="button" onClick={cancelSectionCreate}>Cancel</button></div>
              </form> : <button type="button" className="add-section-trigger" onClick={() => { setSectionTitle(""); setAddingSection(true); }}><Plus size={16} aria-hidden="true" />Add section</button>}
            </div>
            {projectSections.map((section) => {
              const sectionTasks = allTasks.filter((task) => task.projectId === targetProjectId && task.sectionId === section.id);
              return <section key={section.id} className={clsx("drop-zone", activeDropZone === sectionPlacement(section.id) && "drop-active")} onDragEnter={markDropZone(targetProjectId, section.id)} onDragOver={markDropZone(targetProjectId, section.id)} onDragLeave={() => setActiveDropZone(null)} onDrop={moveDroppedTask(targetProjectId, section.id)} aria-label={`Section ${section.title}`}>
                <div className={clsx("section-header", draggingSectionId === section.id && "section-dragging", activeSectionDrop?.id === section.id && `section-drop-${activeSectionDrop.position}`)} draggable={editSectionId !== section.id} onDragStart={startSectionDrag(section)} onDragEnd={() => { setDraggingSectionId(null); setActiveSectionDrop(null); }} onDragOver={markSectionDrop(section)} onDragLeave={() => setActiveSectionDrop(null)} onDrop={dropSection(section, projectSections)}>
                  {editSectionId === section.id ? <form className="section-edit-form" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditSectionId(null); setEditSectionTitle(""); } }} onSubmit={submitSectionEdit(section)}>
                    <label htmlFor={`section-edit-${section.id}`}>Section title</label><input id={`section-edit-${section.id}`} autoFocus value={editSectionTitle} onChange={(event) => setEditSectionTitle(event.target.value)} />
                    <button type="submit">Save section</button><button type="button" onClick={() => { setEditSectionId(null); setEditSectionTitle(""); }}>Cancel</button>
                  </form> : <><h2>{section.title}</h2><div className="section-actions">
                    <button type="button" aria-label={`Add task to section ${section.title}`} onClick={() => openAddTaskDialog(sectionPlacement(section.id))}><Plus size={14} aria-hidden="true" />Add task</button>
                    <button type="button" aria-label={`Edit section ${section.title}`} onClick={() => startSectionEdit(section)}><Edit3 size={14} aria-hidden="true" />Edit</button>
                    <button type="button" className="danger" aria-label={`Delete section ${section.title}`} onClick={() => requestSectionDelete(section)}><Trash2 size={14} aria-hidden="true" />Delete</button>
                  </div></>}
                </div>
                {sectionTasks.length > 0 ? renderTaskNodes(sectionTasks, taskActions) : <p className="empty">Drop project tasks here.</p>}
              </section>;
            })}
          </div>
        )}
      </section>
      {markdownModal !== null ? (
        <FloatingOverlay className={clsx("markdown-modal-backdrop", scopeExportOpen && "scope-preview-backdrop")} lockScroll>
          <FloatingFocusManager context={markdownFloating.context}>
          <section
            ref={markdownFloating.refs.setFloating}
            className="markdown-modal"
            role="dialog"
            aria-modal="true"
            aria-label={markdownModal.format === "json" ? "JSON preview" : "Markdown preview"}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setMarkdownModal(null);
              }
            }}
          >
            <header className="markdown-modal-header">
              <h2>{markdownModal.title} {markdownModal.format ?? "markdown"}</h2>
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
      {scopeExportOpen ? <div className="export-options-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setScopeExportOpen(false); }}>
        <section className="export-options-modal" role="dialog" aria-modal="true" aria-label="Export options" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setScopeExportOpen(false); } }}>
          <header><div><p className="eyebrow">Export</p><h2>{targetProjectId === null ? "Inbox" : scopeProject?.title ?? taskTargetLabel}</h2></div><button type="button" aria-label="Close export options" onClick={() => setScopeExportOpen(false)}><X size={18} aria-hidden="true" /></button></header>
          <div className="export-options-formats">
            <section className="card export-format-card" aria-labelledby="scope-markdown-export-title">
              <div><h3 id="scope-markdown-export-title">Markdown</h3><p>Readable task list for {targetProjectId === null ? "Inbox" : scopeProject?.title ?? taskTargetLabel}.</p></div>
              <div className="export-format-actions">
                <button type="button" onClick={() => setMarkdownModal(Object.freeze({ title: targetProjectId === null ? "Inbox" : taskTargetLabel, markdown, format: "markdown" }))}><Eye size={16} aria-hidden="true" />Preview markdown</button>
                <button type="button" onClick={async () => { await copyText(markdown); setCopyStatus("Markdown copied"); }}><ClipboardCopy size={16} aria-hidden="true" />Copy markdown</button>
              </div>
            </section>
            <section className="card export-format-card" aria-labelledby="scope-json-export-title">
              <div><h3 id="scope-json-export-title">JSON</h3><p>Complete structured data with tasks, sections, dates, descriptions, labels, and comments.</p></div>
              <div className="export-format-actions">
                <button type="button" onClick={() => setMarkdownModal(Object.freeze({ title: targetProjectId === null ? "Inbox" : taskTargetLabel, markdown: scopeJson, format: "json" }))}><Eye size={16} aria-hidden="true" />Preview JSON</button>
                <button type="button" onClick={async () => { await copyText(scopeJson); setCopyStatus("JSON copied"); }}><ClipboardCopy size={16} aria-hidden="true" />Copy JSON</button>
              </div>
            </section>
          </div>
          {copyStatus === "Markdown copied" || copyStatus === "JSON copied" ? <p className="export-copy-status" role="status">{copyStatus}</p> : null}
        </section>
      </div> : null}
      {addTaskOpen ? <div className="task-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddTaskOpen(false); }}>
        <section className="add-task-dialog" role="dialog" aria-modal="true" aria-label="Add task" onKeyDown={(event) => { if (event.key === "Escape" && !addTaskDatePickerOpen) setAddTaskOpen(false); }}>
          <header><h2>Add task</h2><button type="button" aria-label="Close add task" onClick={() => setAddTaskOpen(false)}><X size={18} /></button></header>
          <form onSubmit={async (event) => {
            event.preventDefault();
            const taskTitle = addTaskTitle.trim();
            if (!taskTitle) return;
            const placement = parsePlacement(addTaskPlacement, allSections);
            const created = await api.createTask(taskTitle, placement.projectId, placement.sectionId, null);
            const patch: Parameters<ApplicationApi["updateTask"]>[1] = { description: addTaskDescription, dueDate: addTaskDate || null, labels: addTaskLabels.split(",").map((label) => label.trim()).filter(Boolean) };
            if (patch.description || patch.dueDate || patch.labels?.length) await api.updateTask(created.id, patch);
            await queryClient.invalidateQueries({ queryKey: taskQueryKey });
            setAddTaskOpen(false);
          }}>
            <label>Task name<AutoGrowTextarea autoFocus ariaLabel="New task title" value={addTaskTitle} onChange={setAddTaskTitle} required onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /></label>
            <label>Description<AutoGrowTextarea ariaLabel="New task description" value={addTaskDescription} onChange={setAddTaskDescription} /></label>
            <label>Project or section<select aria-label="Add task project" value={addTaskPlacement} onChange={(event) => setAddTaskPlacement(event.target.value)}>
              {createPlacementOptions(activeProjects, allSections.filter((section) => section.projectId === null || activeProjects.some((project) => project.id === section.projectId))).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select></label>
            <label>Date{addTaskDate ? <div className="task-detail-meta-value"><button type="button" className="task-detail-date" onClick={() => { setAddTaskDateBeforePicker(addTaskDate); setAddTaskDatePickerOpen(true); }}>{new Date(`${addTaskDate}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</button><button type="button" aria-label="Remove task date" onClick={() => setAddTaskDate("")}>×</button></div> : <button type="button" aria-label="Add date" className="btn-primary add-task-date-button" onClick={() => { setAddTaskDateBeforePicker(addTaskDate); setAddTaskDatePickerOpen(true); }}>＋ Add date</button>}</label>
            <label>Labels<input aria-label="New task labels" value={addTaskLabels} onChange={(event) => setAddTaskLabels(event.target.value)} placeholder="Separate labels with commas" /></label>
            <div><button type="button" onClick={() => setAddTaskOpen(false)}>Cancel</button><button type="submit" className="btn-primary">Add task</button></div>
          </form>
          {addTaskDatePickerOpen ? <div className="task-date-picker-backdrop"><section className="task-date-picker" role="dialog" aria-modal="true" aria-label="Add date" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAddTaskDate(addTaskDateBeforePicker); setAddTaskDatePickerOpen(false); } }}><h3>Add date</h3><DatePickerPanel inputLabel="New task date" value={addTaskDate} onChange={setAddTaskDate} /><div className="task-date-picker-actions"><button type="button" onClick={() => { setAddTaskDate(addTaskDateBeforePicker); setAddTaskDatePickerOpen(false); }}>Cancel</button><button type="button" className="btn-primary" onClick={() => setAddTaskDatePickerOpen(false)}>Set date</button></div></section></div> : null}
        </section>
      </div> : null}
      {selectedDetailsTask !== null ? (
        <div className="task-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailsTaskId(null); }}>
          <section className="task-details-modal" role="dialog" aria-modal="true" aria-label={`Task details: ${selectedDetailsTask.title}`} onKeyDown={(event) => { if (event.key === "Escape" && editingDetailField === null && !datePickerOpen) setDetailsTaskId(null); }}>
            <header className="task-details-header"><div className="task-details-header-path"><a href={selectedDetailsProject === null ? "/" : `/?project=${encodeURIComponent(selectedDetailsProject.id)}`}>{selectedDetailsProject?.title ?? "Inbox"}</a>{selectedDetailsSection !== null ? <><span aria-hidden="true">/</span><span>{selectedDetailsSection.title}</span></> : null}{selectedDetailsParent !== null ? <><span aria-hidden="true">/</span><a href={`/?task=${encodeURIComponent(selectedDetailsParent.id)}`}>{selectedDetailsParent.title}</a></> : null}<span aria-hidden="true">/</span><strong>{selectedDetailsTask.title}</strong></div><div><button type="button" aria-label="Close task details" onClick={() => setDetailsTaskId(null)}><X size={18} /></button></div></header>
            <div className="task-details-layout">
              <div className="task-details-main">
                <div className="task-detail-editable">
                  {editingDetailField === "title" ? <div className="task-detail-editor"><AutoGrowTextarea autoFocus ariaLabel="Edit task title" value={detailTitle} onChange={setDetailTitle} onKeyDown={async (event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDetailTitle(selectedDetailsTask.title); setEditingDetailField(null); } if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); const value = detailTitle.trim(); if (value && await saveTaskDetails({ title: value })) setEditingDetailField(null); } }} /><div><button type="button" onClick={() => { setDetailTitle(selectedDetailsTask.title); setEditingDetailField(null); }}>Cancel</button><button type="button" className="btn-primary" onClick={async () => { const value = detailTitle.trim(); if (value && await saveTaskDetails({ title: value })) setEditingDetailField(null); }}>Save</button></div></div> : <button type="button" className="task-detail-title-display" aria-label="Edit task title" onClick={() => { setDetailTitle(selectedDetailsTask.title); setEditingDetailField("title"); }}>{selectedDetailsTask.title}</button>}
                  {editingDetailField === "description" ? <div className="task-detail-editor"><AutoGrowTextarea autoFocus ariaLabel="Edit task description" value={detailDescription} onChange={setDetailDescription} onKeyDown={async (event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDetailDescription(selectedDetailsTask.description); setEditingDetailField(null); } if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (await saveTaskDetails({ description: detailDescription })) setEditingDetailField(null); } }} /><div><button type="button" onClick={() => { setDetailDescription(selectedDetailsTask.description); setEditingDetailField(null); }}>Cancel</button><button type="button" className="btn-primary" onClick={async () => { if (await saveTaskDetails({ description: detailDescription })) setEditingDetailField(null); }}>Save</button></div></div> : <button type="button" className="task-detail-description-display" aria-label="Edit task description" onClick={() => { setDetailDescription(selectedDetailsTask.description); setEditingDetailField("description"); }}>{selectedDetailsTask.description || "Add description"}</button>}
                </div>
                <section className="card border task-subtasks-card" aria-labelledby="task-subtasks-title">
                  <div className="card-header bg-light"><strong id="task-subtasks-title">Subtasks</strong><span className="text-muted">{selectedDetailsTask.children.filter((child) => child.completed).length}/{selectedDetailsTask.children.length}</span></div>
                  <div className="card-body task-subtasks-body">
                    {selectedDetailsTask.children.map((child) => <div className="details-subtask-row" key={child.id}><button type="button" className="details-subtask" onClick={() => openDetails(child)}>{child.title}</button><button type="button" aria-label={`Delete subtask ${child.title}`} onClick={async () => { if (!confirmDeletion(`Delete subtask “${child.title}” and its descendants?`)) return; await api.deleteTask(child.id); await queryClient.invalidateQueries({ queryKey: taskQueryKey }); }}>Delete</button></div>)}
                    <div className="details-subtask-add"><AutoGrowTextarea ariaLabel="New subtask title" value={detailSubtask} onChange={setDetailSubtask} onKeyDown={async (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); const title = detailSubtask.trim(); if (!title) return; await api.createTask(title, selectedDetailsTask.projectId, selectedDetailsTask.sectionId, selectedDetailsTask.id); setDetailSubtask(""); await queryClient.invalidateQueries({ queryKey: taskQueryKey }); } }} placeholder="Add subtask" /><button type="button" className="btn-primary" onClick={async () => { const title = detailSubtask.trim(); if (!title) return; await api.createTask(title, selectedDetailsTask.projectId, selectedDetailsTask.sectionId, selectedDetailsTask.id); setDetailSubtask(""); await queryClient.invalidateQueries({ queryKey: taskQueryKey }); }}>Add</button></div>
                  </div>
                </section>
              <section className="task-comments"><h3>Comments</h3>
                {selectedDetailsTask.comments.map((comment) => <article className="task-comment" key={comment.id}>
                  {editingCommentId === comment.id ? <><AutoGrowTextarea ariaLabel={`Edit comment ${comment.id}`} value={editingCommentBody} onChange={setEditingCommentBody} /><div><button type="button" className="btn-primary" onClick={async () => { const comments = selectedDetailsTask.comments.map((item) => item.id === comment.id ? Object.freeze({ ...item, body: editingCommentBody.trim() }) : item); await api.updateTask(selectedDetailsTask.id, { comments }); setEditingCommentId(null); await queryClient.invalidateQueries({ queryKey: taskQueryKey }); }}>Save comment</button><button type="button" onClick={() => setEditingCommentId(null)}>Cancel</button></div></> : <><p>{comment.body}</p><small>{new Date(comment.createdAt).toLocaleString()}</small><div><button type="button" onClick={() => { setEditingCommentId(comment.id); setEditingCommentBody(comment.body); }}>Edit</button><button type="button" className="danger" onClick={async () => { if (!confirmDeletion("Delete this comment?")) return; await api.updateTask(selectedDetailsTask.id, { comments: selectedDetailsTask.comments.filter((item) => item.id !== comment.id) }); await queryClient.invalidateQueries({ queryKey: taskQueryKey }); }}>Delete</button></div></>}
                </article>)}
                <label>Add comment<AutoGrowTextarea ariaLabel="Add comment" value={detailComment} onChange={setDetailComment} /></label>
                <button type="button" className="btn-primary" disabled={!detailComment.trim()} onClick={async () => { const comments = [...selectedDetailsTask.comments, { id: crypto.randomUUID(), body: detailComment.trim(), createdAt: new Date().toISOString() }]; await api.updateTask(selectedDetailsTask.id, { comments }); setDetailComment(""); await queryClient.invalidateQueries({ queryKey: taskQueryKey }); }}>Add comment</button>
              </section>
              </div>
              <aside className="task-details-sidebar">
                <section><h3>Project</h3><select className="form-select" aria-label="Project or Inbox" value={detailProjectId === null ? "inbox" : `project:${detailProjectId}`} onChange={async (event) => { const projectId = event.target.value === "inbox" ? null : event.target.value.slice("project:".length); setDetailProjectId(projectId); setDetailSaveStatus("Saving…"); try { await api.moveTask(selectedDetailsTask.id, projectId, null, null, null, null); await queryClient.invalidateQueries({ queryKey: taskQueryKey }); setDetailSaveStatus("Saved"); } catch { setDetailProjectId(selectedDetailsTask.projectId); setDetailSaveStatus("Could not save changes"); } }}><option value="inbox">Inbox</option>{activeProjects.map((project) => <option key={project.id} value={`project:${project.id}`}>{project.title}</option>)}</select></section>
                <section><h3>Date</h3>{detailDueDate ? <div className="task-detail-meta-value"><button type="button" className="task-detail-date" onClick={() => setDatePickerOpen(true)} title={detailDueDate}>{new Date(`${detailDueDate}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</button><button type="button" aria-label="Remove date" onClick={async () => { setDetailDueDate(""); await saveTaskDetails({ dueDate: null }); }}>×</button></div> : <button type="button" className="btn-primary" onClick={() => setDatePickerOpen(true)}>＋ Add date</button>}</section>
                <section><div className="task-detail-label-heading"><h3>Labels</h3><button type="button" aria-label="Add label" onClick={() => setDetailLabelInput(" ")}>＋</button></div><div className="detail-label-chips">{selectedDetailsTask.labels.map((label) => <span className="task-detail-label" key={label}>{label}<button type="button" aria-label={`Remove label ${label}`} onClick={() => { const labels = selectedDetailsTask.labels.filter((item) => item !== label); setDetailLabels(labels.join(", ")); void saveTaskDetails({ labels }); }}>×</button></span>)}</div>{detailLabelInput !== "" ? <><input autoFocus aria-label="Labels" list="task-label-options" value={detailLabelInput.trimStart()} placeholder="Add a label" onChange={(event) => setDetailLabelInput(event.target.value)} onKeyDown={async (event) => { if (event.key === "Escape") setDetailLabelInput(""); if (event.key === "Enter") { event.preventDefault(); const label = detailLabelInput.trim(); if (!label) return; const labels = Array.from(new Set([...selectedDetailsTask.labels, label])); if (await saveTaskDetails({ labels })) setDetailLabelInput(""); } }} /><datalist id="task-label-options">{Array.from(new Set(flatTasks.flatMap((task) => task.labels))).map((label) => <option key={label} value={label} />)}</datalist></> : null}</section>
                <p className="task-autosave-status" aria-live="polite">{detailSaveStatus}</p>
              </aside>
            </div>
            {datePickerOpen ? <div className="task-date-picker-backdrop"><section className="task-date-picker" role="dialog" aria-modal="true" aria-label="Change date" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDetailDueDate(selectedDetailsTask.dueDate ?? ""); setDatePickerOpen(false); } if (event.key === "Enter" && (event.target as HTMLElement).tagName !== "BUTTON") { event.preventDefault(); void saveTaskDetails({ dueDate: detailDueDate || null }).then((saved) => { if (saved) setDatePickerOpen(false); }); } }}><h3>{selectedDetailsTask.dueDate ? "Change date" : "Add date"}</h3><DatePickerPanel inputLabel="New date" value={detailDueDate} onChange={setDetailDueDate} /><div className="task-date-picker-actions"><button type="button" onClick={() => { setDetailDueDate(selectedDetailsTask.dueDate ?? ""); setDatePickerOpen(false); }}>Cancel</button><button type="button" className="btn-primary" onClick={async () => { if (await saveTaskDetails({ dueDate: detailDueDate || null })) setDatePickerOpen(false); }}>Save date</button></div></section></div> : null}
          </section>
        </div>
      ) : null}
    </main>
    </DndContext>
  );
};

export const ToolsPage = ({ api, navigationApi }: Readonly<{ api: ToolsApi; navigationApi?: ApplicationApi }>) => {
  const [selectedTable, setSelectedTable] = useState("");
  useEffect(() => { const openQuickAdd = (event: globalThis.KeyboardEvent) => { const target = event.target; const typing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)); if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey && ["q", "й"].includes(event.key.toLocaleLowerCase())) window.location.href = "/?addTask=1"; }; window.addEventListener("keydown", openQuickAdd); return () => window.removeEventListener("keydown", openQuickAdd); }, []);
  const [projectTitle, setProjectTitle] = useState("");
  const [sql, setSql] = useState("SELECT * FROM tasks ORDER BY lexical_order;");
  const [result, setResult] = useState<unknown>(Object.freeze({ ready: true }));
  const [recordsLimit, setRecordsLimit] = useState<"10" | "100" | "all">("10");
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: projectQueryKey, queryFn: navigationApi?.listProjects ?? (async () => Object.freeze([])) });
  const taskTree = useQuery({ queryKey: taskQueryKey, queryFn: navigationApi?.listTasks ?? (async () => Object.freeze([])) });
  const navigationSections = useQuery({ queryKey: sectionQueryKey, queryFn: navigationApi?.listSections ?? (async () => Object.freeze([])) });

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
        <SearchPalette tasks={flattenTaskNodes(taskTree.data ?? Object.freeze([]))} projects={projects.data ?? Object.freeze([])} sections={navigationSections.data ?? Object.freeze([])} onTaskSelect={(task) => { window.location.href = `/?task=${encodeURIComponent(task.id)}`; }} />
        <a className="nav-button add-task-nav-button" href="/?addTask=1"><Plus size={17} aria-hidden="true" />Add task <kbd>Q</kbd></a>
        <a className="nav-button nav-link-button" href="/">
          <Inbox size={16} aria-hidden="true" />
          Inbox
        </a>
        <a className="nav-button nav-link-button" href="/dates"><CalendarDays size={16} aria-hidden="true" />Dates</a>
        <a className="nav-button nav-link-button" href="/labels"><Tag size={16} aria-hidden="true" />Labels</a>
        <a className="nav-button nav-link-button" href="/export"><Download size={16} aria-hidden="true" />Export</a>
        <a className="nav-button nav-link-button active" href="/tools">
          <Code2 size={16} aria-hidden="true" />
          Tools
        </a>
        <a className="nav-button nav-link-button" href="/settings">
          <Settings size={16} aria-hidden="true" />
          Settings
        </a>
        <a className="nav-button nav-link-button" href="/archived-projects"><Archive size={16} aria-hidden="true" /> Archived projects</a>
        <div className="sidebar-group"><h2>My Projects</h2>{(projects.data ?? []).filter((project) => !project.archived).map((project) => <a className="nav-button nav-link-button project-tool-link" key={project.id} title={project.title} href={`/?project=${encodeURIComponent(project.id)}`}># <span>{project.title}</span></a>)}</div>
        {navigationApi ? <div className="card bg-light border p-3 sidebar-create-block"><form className="compact-form m-0" onSubmit={async (event) => { event.preventDefault(); const nextTitle = projectTitle.trim(); if (!nextTitle) return; await navigationApi.createProject(nextTitle); setProjectTitle(""); await queryClient.invalidateQueries({ queryKey: projectQueryKey }); }}><label htmlFor="tools-project-title">Project title</label><input id="tools-project-title" value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} /><button type="submit"><Plus size={16} aria-hidden="true" />Add project</button></form></div> : null}
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
  const [navigationProjectTitle, setNavigationProjectTitle] = useState("");
  const settings = useQuery({ queryKey: settingsQueryKey, queryFn: api.getSettings });
  const authStatus = useQuery({ queryKey: authStatusQueryKey, queryFn: api.getAuthStatus });
  const [confirmDelete, setConfirmDelete] = useState(true);
  const [accessMode, setAccessMode] = useState<AppSettings["accessMode"]>("anonymous");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  useEffect(() => {
    const openQuickAdd = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey && ["q", "й"].includes(event.key.toLocaleLowerCase())) window.location.href = "/?addTask=1";
    };
    window.addEventListener("keydown", openQuickAdd);
    return () => window.removeEventListener("keydown", openQuickAdd);
  }, []);
  const projects = useQuery({ queryKey: projectQueryKey, queryFn: api.listProjects });
  const sections = useQuery({ queryKey: sectionQueryKey, queryFn: api.listSections });
  const tasks = useQuery({ queryKey: taskQueryKey, queryFn: api.listTasks });

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
        <SearchPalette tasks={flattenTaskNodes(tasks.data ?? Object.freeze([]))} projects={projects.data ?? Object.freeze([])} sections={sections.data ?? Object.freeze([])} onTaskSelect={(task) => { window.location.href = `/?task=${encodeURIComponent(task.id)}`; }} />
        <a className="nav-button add-task-nav-button" href="/?addTask=1"><Plus size={17} aria-hidden="true" />Add task <kbd>Q</kbd></a>
        <a className="nav-button nav-link-button" href="/"><Inbox size={16} aria-hidden="true" />Inbox</a>
        <a className="nav-button nav-link-button" href="/dates"><CalendarDays size={16} aria-hidden="true" />Dates</a>
        <a className="nav-button nav-link-button" href="/labels"><Tag size={16} aria-hidden="true" />Labels</a>
        <a className="nav-button nav-link-button" href="/export"><Download size={16} aria-hidden="true" />Export</a>
        {toolsEnabled ? <a className="nav-button nav-link-button" href="/tools"><Code2 size={16} aria-hidden="true" />Tools</a> : null}
        <a className="nav-button nav-link-button active" href="/settings"><Settings size={16} aria-hidden="true" />Settings</a>
        <a className="nav-button nav-link-button" href="/archived-projects"><Archive size={16} aria-hidden="true" />Archived projects</a>
        <div className="sidebar-group"><h2>My Projects</h2>{(projects.data ?? []).filter((project) => !project.archived).map((project) => <a className="nav-button nav-link-button project-tool-link" key={project.id} href={`/?project=${encodeURIComponent(project.id)}`}># <span>{project.title}</span></a>)}</div>
        <div className="card bg-light border p-3 sidebar-create-block"><form className="compact-form m-0" onSubmit={async (event) => { event.preventDefault(); const value = navigationProjectTitle.trim(); if (!value) return; await api.createProject(value); setNavigationProjectTitle(""); await queryClient.invalidateQueries({ queryKey: projectQueryKey }); }}><label htmlFor="settings-project-title">Project title</label><input id="settings-project-title" value={navigationProjectTitle} onChange={(event) => setNavigationProjectTitle(event.target.value)} /><button type="submit"><Plus size={16} aria-hidden="true" />Add project</button></form></div>
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
    <aside className="sidebar card shadow-sm" aria-label="Navigation"><div className="sidebar-brand"><span className="brand-mark">T</span><strong>Todoist Clone</strong></div><a className="nav-button nav-link-button" href="/"><Inbox size={16} /> Inbox</a><a className="nav-button nav-link-button" href="/export"><Download size={16} /> Export</a><a className="nav-button nav-link-button active" href="/archived-projects"><Archive size={16} /> Archived projects</a></aside>
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
    return <ToolsPage api={createToolsApi()} navigationApi={api} />;
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
