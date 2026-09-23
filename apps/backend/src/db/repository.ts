import { generateLexicalOrder } from "@todoist-clonse/domain";
import type { Priority, Task, TaskId } from "@todoist-clonse/domain";
import { asc, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { tasks as tasksTable } from "./schema";
import type { TaskMove, TaskPatch, TaskRepository } from "../repository";

type TaskRow = typeof tasksTable.$inferSelect;

const freezeTask = (task: Task): Task => Object.freeze(task);

const normalizeDate = (value: Date | string): string =>
  typeof value === "string" ? new Date(value).toISOString() : value.toISOString();

const toTask = (row: TaskRow): Task =>
  freezeTask({
    id: row.id,
    title: row.title,
    completed: row.completed,
    priority: row.priority as Priority,
    parentId: row.parentId,
    lexicalOrder: row.lexicalOrder,
    createdAt: normalizeDate(row.createdAt),
    updatedAt: normalizeDate(row.updatedAt)
  });

const rowOrder = asc(tasksTable.lexicalOrder);

const findSiblingOrder = async (
  db: ReturnType<typeof drizzle>,
  parentId: TaskId | null,
  beforeId: TaskId | null,
  afterId: TaskId | null
) => {
  const siblings = await db
    .select()
    .from(tasksTable)
    .where(parentId === null ? isNull(tasksTable.parentId) : eq(tasksTable.parentId, parentId))
    .orderBy(rowOrder);
  const before = beforeId === null ? siblings.at(-1) : siblings.find((task) => task.id === beforeId);
  const after = afterId === null ? null : siblings.find((task) => task.id === afterId);

  return generateLexicalOrder(before?.lexicalOrder ?? null, after?.lexicalOrder ?? null);
};

const collectDescendantIds = async (db: ReturnType<typeof drizzle>, id: TaskId): Promise<ReadonlyArray<TaskId>> => {
  const children = await db.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.parentId, id));
  const descendantIds = await Promise.all(children.map((child) => collectDescendantIds(db, child.id)));

  return Object.freeze([id, ...descendantIds.flat()]);
};

const firstTask = (rows: ReadonlyArray<TaskRow>) => (rows[0] === undefined ? null : toTask(rows[0]));

export const createPostgresTaskRepository = (databaseUrl: string): TaskRepository => {
  const client = postgres(databaseUrl, { max: 10 });
  const db = drizzle(client);

  return Object.freeze({
    list: async () => {
      const rows = await db.select().from(tasksTable).orderBy(rowOrder);

      return Object.freeze(rows.map(toTask));
    },
    create: async (title, priority, parentId) => {
      const id = crypto.randomUUID();
      const lexicalOrder = await findSiblingOrder(db, parentId, null, null);
      const rows = await db
        .insert(tasksTable)
        .values({
          id,
          title,
          completed: false,
          priority,
          parentId,
          lexicalOrder
        })
        .returning();

      const task = firstTask(rows);

      if (task === null) {
        throw new Error("Task insert failed");
      }

      return task;
    },
    patch: async (id, patch: TaskPatch) => {
      const rows = await db
        .update(tasksTable)
        .set({
          ...patch,
          updatedAt: new Date()
        })
        .where(eq(tasksTable.id, id))
        .returning();

      return firstTask(rows);
    },
    move: async (id, move: TaskMove) => {
      const existing = await db.select().from(tasksTable).where(eq(tasksTable.id, id)).limit(1);

      if (existing[0] === undefined) {
        return null;
      }

      const lexicalOrder = await findSiblingOrder(db, move.parentId, move.beforeId, move.afterId);
      const rows = await db
        .update(tasksTable)
        .set({
          parentId: move.parentId,
          lexicalOrder,
          updatedAt: new Date()
        })
        .where(eq(tasksTable.id, id))
        .returning();

      return firstTask(rows);
    },
    delete: async (id) => {
      const deletedIds = await collectDescendantIds(db, id);

      if (deletedIds.length === 0) {
        return false;
      }

      const rows = await db
        .delete(tasksTable)
        .where(inArray(tasksTable.id, [...deletedIds]))
        .returning({ id: tasksTable.id });

      return rows.length > 0;
    }
  });
};
