import { generateLexicalOrder } from "@todoist-clonse/domain";
import type { Priority, Project, ProjectId, Section, SectionId, Task, TaskId } from "@todoist-clonse/domain";

export type TaskPatch = Readonly<{
  title?: string;
  completed?: boolean;
  priority?: Priority;
  projectId?: ProjectId | null;
  sectionId?: SectionId | null;
}>;

export type TaskMove = Readonly<{
  parentId: TaskId | null;
  projectId: ProjectId | null;
  sectionId: SectionId | null;
  beforeId: TaskId | null;
  afterId: TaskId | null;
}>;

export type TaskRepository = Readonly<{
  list: () => Promise<ReadonlyArray<Task>>;
  listProjects: () => Promise<ReadonlyArray<Project>>;
  createProject: (title: string) => Promise<Project>;
  listSections: () => Promise<ReadonlyArray<Section>>;
  createSection: (title: string, projectId: ProjectId | null) => Promise<Section>;
  updateSection: (id: SectionId, title: string) => Promise<Section | null>;
  deleteSection: (id: SectionId) => Promise<boolean>;
  create: (
    title: string,
    priority: Priority,
    parentId: TaskId | null,
    projectId: ProjectId | null,
    sectionId: SectionId | null
  ) => Promise<Task>;
  patch: (id: TaskId, patch: TaskPatch) => Promise<Task | null>;
  move: (id: TaskId, move: TaskMove) => Promise<Task | null>;
  delete: (id: TaskId) => Promise<boolean>;
}>;

const freezeTask = (task: Task): Task => Object.freeze(task);
const freezeProject = (project: Project): Project => Object.freeze(project);
const freezeSection = (section: Section): Section => Object.freeze(section);

const now = () => new Date().toISOString();

const compareOrder = (left: Task, right: Task) => left.lexicalOrder.localeCompare(right.lexicalOrder);

const findSiblingOrder = (
  tasks: ReadonlyArray<Task>,
  parentId: TaskId | null,
  projectId: ProjectId | null,
  sectionId: SectionId | null,
  beforeId: TaskId | null,
  afterId: TaskId | null
) => {
  const siblings = tasks
    .filter((task) => task.parentId === parentId && task.projectId === projectId && task.sectionId === sectionId)
    .toSorted(compareOrder);
  const before = beforeId === null ? siblings.at(-1) : siblings.find((task) => task.id === beforeId);
  const after = afterId === null ? null : siblings.find((task) => task.id === afterId);

  return generateLexicalOrder(before?.lexicalOrder ?? null, after?.lexicalOrder ?? null);
};

export const createMemoryTaskRepository = (
  initialTasks: ReadonlyArray<Task> = Object.freeze([])
): TaskRepository => {
  let tasks = Object.freeze(initialTasks.map(freezeTask));
  let projects = Object.freeze([] as ReadonlyArray<Project>);
  let sections = Object.freeze([] as ReadonlyArray<Section>);

  const replace = (nextTasks: ReadonlyArray<Task>) => {
    tasks = Object.freeze(nextTasks.map(freezeTask));
  };

  return Object.freeze({
    list: async () => tasks,
    listProjects: async () => projects,
    createProject: async (title) => {
      const createdAt = now();
      const project = freezeProject({
        id: crypto.randomUUID(),
        title,
        lexicalOrder: generateLexicalOrder(projects.at(-1)?.lexicalOrder ?? null, null),
        createdAt,
        updatedAt: createdAt
      });

      projects = Object.freeze([...projects, project]);

      return project;
    },
    listSections: async () => sections,
    createSection: async (title, projectId) => {
      const createdAt = now();
      const siblings = sections.filter((section) => section.projectId === projectId);
      const section = freezeSection({
        id: crypto.randomUUID(),
        title,
        projectId,
        lexicalOrder: generateLexicalOrder(siblings.at(-1)?.lexicalOrder ?? null, null),
        createdAt,
        updatedAt: createdAt
      });

      sections = Object.freeze([...sections, section]);

      return section;
    },
    updateSection: async (id, title) => {
      const existing = sections.find((section) => section.id === id);

      if (existing === undefined) {
        return null;
      }

      const updated = freezeSection({
        ...existing,
        title,
        updatedAt: now()
      });

      sections = Object.freeze(sections.map((section) => (section.id === id ? updated : section)));

      return updated;
    },
    deleteSection: async (id) => {
      const existing = sections.find((section) => section.id === id);

      if (existing === undefined) {
        return false;
      }

      sections = Object.freeze(sections.filter((section) => section.id !== id));
      replace(tasks.map((task) => (task.sectionId === id ? freezeTask({ ...task, parentId: null, sectionId: null, updatedAt: now() }) : task)));

      return true;
    },
    create: async (title, priority, parentId, projectId, sectionId) => {
      const createdAt = now();
      const task = freezeTask({
        id: crypto.randomUUID(),
        title,
        completed: false,
        priority,
        parentId,
        projectId,
        sectionId,
        lexicalOrder: findSiblingOrder(tasks, parentId, projectId, sectionId, null, null),
        createdAt,
        updatedAt: createdAt
      });

      replace([...tasks, task]);

      return task;
    },
    patch: async (id, patch) => {
      const existing = tasks.find((task) => task.id === id);

      if (existing === undefined) {
        return null;
      }

      const updated = freezeTask({
        ...existing,
        ...patch,
        updatedAt: now()
      });

      replace(tasks.map((task) => (task.id === id ? updated : task)));

      return updated;
    },
    move: async (id, move) => {
      const existing = tasks.find((task) => task.id === id);

      if (existing === undefined) {
        return null;
      }

      const updated = freezeTask({
        ...existing,
        parentId: move.parentId,
        projectId: move.projectId,
        sectionId: move.sectionId,
        lexicalOrder: findSiblingOrder(
          tasks.filter((task) => task.id !== id),
          move.parentId,
          move.projectId,
          move.sectionId,
          move.beforeId,
          move.afterId
        ),
        updatedAt: now()
      });

      replace(tasks.map((task) => (task.id === id ? updated : task)));

      return updated;
    },
    delete: async (id) => {
      const existing = tasks.find((task) => task.id === id);

      if (existing === undefined) {
        return false;
      }

      const collectDescendantIds = (parentId: TaskId): ReadonlyArray<TaskId> =>
        Object.freeze([
          parentId,
          ...tasks
            .filter((task) => task.parentId === parentId)
            .flatMap((task) => collectDescendantIds(task.id))
        ]);

      const deletedIds = new Set(collectDescendantIds(id));

      replace(tasks.filter((task) => !deletedIds.has(task.id)));

      return true;
    }
  });
};
