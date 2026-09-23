import { generateLexicalOrder } from "@todoist-clonse/domain";
import type { Priority, Task, TaskId } from "@todoist-clonse/domain";

export type TaskPatch = Readonly<{
  title?: string;
  completed?: boolean;
  priority?: Priority;
}>;

export type TaskMove = Readonly<{
  parentId: TaskId | null;
  beforeId: TaskId | null;
  afterId: TaskId | null;
}>;

export type TaskRepository = Readonly<{
  list: () => Promise<ReadonlyArray<Task>>;
  create: (title: string, priority: Priority, parentId: TaskId | null) => Promise<Task>;
  patch: (id: TaskId, patch: TaskPatch) => Promise<Task | null>;
  move: (id: TaskId, move: TaskMove) => Promise<Task | null>;
  delete: (id: TaskId) => Promise<boolean>;
}>;

const freezeTask = (task: Task): Task => Object.freeze(task);

const now = () => new Date().toISOString();

const compareOrder = (left: Task, right: Task) => left.lexicalOrder.localeCompare(right.lexicalOrder);

const findSiblingOrder = (
  tasks: ReadonlyArray<Task>,
  parentId: TaskId | null,
  beforeId: TaskId | null,
  afterId: TaskId | null
) => {
  const siblings = tasks.filter((task) => task.parentId === parentId).toSorted(compareOrder);
  const before = beforeId === null ? siblings.at(-1) : siblings.find((task) => task.id === beforeId);
  const after = afterId === null ? null : siblings.find((task) => task.id === afterId);

  return generateLexicalOrder(before?.lexicalOrder ?? null, after?.lexicalOrder ?? null);
};

export const createMemoryTaskRepository = (
  initialTasks: ReadonlyArray<Task> = Object.freeze([])
): TaskRepository => {
  let tasks = Object.freeze(initialTasks.map(freezeTask));

  const replace = (nextTasks: ReadonlyArray<Task>) => {
    tasks = Object.freeze(nextTasks.map(freezeTask));
  };

  return Object.freeze({
    list: async () => tasks,
    create: async (title, priority, parentId) => {
      const createdAt = now();
      const task = freezeTask({
        id: crypto.randomUUID(),
        title,
        completed: false,
        priority,
        parentId,
        lexicalOrder: findSiblingOrder(tasks, parentId, null, null),
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
        lexicalOrder: findSiblingOrder(
          tasks.filter((task) => task.id !== id),
          move.parentId,
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
