import { generateLexicalOrder } from "@todoist-clone/domain";
import type { Priority, Project, ProjectId, Section, SectionId, Task, TaskId } from "@todoist-clone/domain";

export type TaskPatch = Readonly<{
  title?: string;
  description?: string;
  dueDate?: string | null;
  labels?: ReadonlyArray<string>;
  comments?: ReadonlyArray<Readonly<{ id: string; body: string; createdAt: string }>>;
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
  updateProject: (id: ProjectId, title: string) => Promise<Project | null>;
  deleteProject: (id: ProjectId) => Promise<boolean>;
  duplicateProject: (id: ProjectId) => Promise<Project | null>;
  setProjectArchived: (id: ProjectId, archived: boolean) => Promise<Project | null>;
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

const now = () => new Date().toISOString();

const collectDescendantIds = (allTasks: ReadonlyArray<Task>, id: TaskId): ReadonlyArray<TaskId> =>
  Object.freeze([
    id,
    ...allTasks
      .filter((task) => task.parentId === id)
      .flatMap((task) => collectDescendantIds(allTasks, task.id))
  ]);

const compareOrder = (left: Task, right: Task): number =>
  left.lexicalOrder < right.lexicalOrder ? -1 : left.lexicalOrder > right.lexicalOrder ? 1 : 0;

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
  const successorIndex = beforeId === null ? -1 : siblings.findIndex((task) => task.id === beforeId);
  const predecessorIndex = afterId === null ? -1 : siblings.findIndex((task) => task.id === afterId);
  const low =
    predecessorIndex >= 0
      ? siblings[predecessorIndex]?.lexicalOrder ?? null
      : beforeId === null && afterId === null
        ? siblings.at(-1)?.lexicalOrder ?? null
        : null;
  const high = successorIndex >= 0 ? siblings[successorIndex]?.lexicalOrder ?? null : null;

  return generateLexicalOrder(low, high);
};

export const createMemoryTaskRepository = (
  initialTasks: ReadonlyArray<Task> = Object.freeze([])
): TaskRepository => {
  let tasks = Object.freeze(initialTasks.map((task) => Object.freeze({ ...task })));
  let projects = Object.freeze([] as ReadonlyArray<Project>);
  let sections = Object.freeze([] as ReadonlyArray<Section>);

  const replace = (nextTasks: ReadonlyArray<Task>) => {
    tasks = Object.freeze(nextTasks.map((task) => Object.freeze({ ...task })));
  };

  return Object.freeze({
    list: async () => tasks,
    listProjects: async () => projects,
    createProject: async (title) => {
      const createdAt = now();
      const project = Object.freeze({
        id: crypto.randomUUID(),
        title,
        archived: false,
        lexicalOrder: generateLexicalOrder(projects.at(-1)?.lexicalOrder ?? null, null),
        createdAt,
        updatedAt: createdAt
      });

      projects = Object.freeze([...projects, project]);

      return project;
    },
    updateProject: async (id, title) => {
      const existing = projects.find((project) => project.id === id);

      if (existing === undefined) {
        return null;
      }

      const updated = Object.freeze({
        ...existing,
        title,
        updatedAt: now()
      });

      projects = Object.freeze(projects.map((project) => (project.id === id ? updated : project)));

      return updated;
    },
    deleteProject: async (id) => {
      const existing = projects.find((project) => project.id === id);

      if (existing === undefined) {
        return false;
      }

      const projectSectionIds = new Set(sections.filter((section) => section.projectId === id).map((section) => section.id));
      const doomedRootIds = tasks
        .filter((task) => task.projectId === id || (task.sectionId !== null && projectSectionIds.has(task.sectionId)))
        .map((task) => task.id);
      const doomedIds = new Set(doomedRootIds.flatMap((taskId) => collectDescendantIds(tasks, taskId)));

      replace(tasks.filter((task) => !doomedIds.has(task.id)));
      sections = Object.freeze(sections.filter((section) => section.projectId !== id));
      projects = Object.freeze(projects.filter((project) => project.id !== id));

      return true;
    },
    duplicateProject: async (id) => {
      const source = projects.find((project) => project.id === id);
      if (source === undefined) return null;
      const createdAt = now();
      const duplicated = Object.freeze({ ...source, id: crypto.randomUUID(), title: `${source.title} copy`, archived: false, createdAt, updatedAt: createdAt });
      const sourceSections = sections.filter((section) => section.projectId === id);
      const sectionMap = new Map(sourceSections.map((section) => [section.id, crypto.randomUUID()]));
      const newSections = sourceSections.map((section) => Object.freeze({ ...section, id: sectionMap.get(section.id)!, projectId: duplicated.id, createdAt, updatedAt: createdAt }));
      const sourceTasks = tasks.filter((task) => task.projectId === id);
      const taskMap = new Map(sourceTasks.map((task) => [task.id, crypto.randomUUID()]));
      const newTasks = sourceTasks.map((task) => Object.freeze({ ...task, id: taskMap.get(task.id)!, projectId: duplicated.id, sectionId: task.sectionId === null ? null : sectionMap.get(task.sectionId) ?? null, parentId: task.parentId === null ? null : taskMap.get(task.parentId) ?? null, createdAt, updatedAt: createdAt }));
      projects = Object.freeze([...projects, duplicated]);
      sections = Object.freeze([...sections, ...newSections]);
      replace([...tasks, ...newTasks]);
      return duplicated;
    },
    setProjectArchived: async (id, archived) => {
      const existing = projects.find((project) => project.id === id);
      if (existing === undefined) return null;
      const updated = Object.freeze({ ...existing, archived, updatedAt: now() });
      projects = Object.freeze(projects.map((project) => project.id === id ? updated : project));
      return updated;
    },
    listSections: async () => sections,
    createSection: async (title, projectId) => {
      const createdAt = now();
      const siblings = sections.filter((section) => section.projectId === projectId);
      const section = Object.freeze({
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

      const updated = Object.freeze({
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
      replace(tasks.map((task) => (task.sectionId === id ? Object.freeze({ ...task, parentId: null, sectionId: null, updatedAt: now() }) : task)));

      return true;
    },
    create: async (title, priority, parentId, projectId, sectionId) => {
      const createdAt = now();
      const task = Object.freeze({
        id: crypto.randomUUID(),
        title,
        description: "",
        dueDate: null,
        labels: Object.freeze([]),
        comments: Object.freeze([]),
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

      const updated = Object.freeze({
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

      const updated = Object.freeze({
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

      const deletedIds = new Set(collectDescendantIds(tasks, id));

      replace(tasks.filter((task) => !deletedIds.has(task.id)));

      return true;
    }
  });
};
