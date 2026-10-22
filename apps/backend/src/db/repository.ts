import { generateLexicalOrder } from "@todoist-clone/domain";
import type { Priority, Project, ProjectId, Section, SectionId, Task, TaskId } from "@todoist-clone/domain";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { projects as projectsTable, sections as sectionsTable, tasks as tasksTable } from "./schema";
import type { TaskMove, TaskPatch, TaskRepository } from "../repository";

type TaskRow = typeof tasksTable.$inferSelect;
type ProjectRow = typeof projectsTable.$inferSelect;
type SectionRow = typeof sectionsTable.$inferSelect;

const normalizeDate = (value: Date | string): string =>
  typeof value === "string" ? new Date(value).toISOString() : value.toISOString();

const toTask = (row: TaskRow): Task =>
  Object.freeze({
    id: row.id,
    title: row.title,
    completed: row.completed,
    priority: row.priority as Priority,
    parentId: row.parentId,
    projectId: row.projectId,
    sectionId: row.sectionId,
    lexicalOrder: row.lexicalOrder,
    createdAt: normalizeDate(row.createdAt),
    updatedAt: normalizeDate(row.updatedAt)
  });

const toProject = (row: ProjectRow): Project =>
  Object.freeze({
    id: row.id,
    title: row.title,
    lexicalOrder: row.lexicalOrder,
    createdAt: normalizeDate(row.createdAt),
    updatedAt: normalizeDate(row.updatedAt)
  });

const toSection = (row: SectionRow): Section =>
  Object.freeze({
    id: row.id,
    title: row.title,
    projectId: row.projectId,
    lexicalOrder: row.lexicalOrder,
    createdAt: normalizeDate(row.createdAt),
    updatedAt: normalizeDate(row.updatedAt)
  });

const rowOrder = asc(sql`${tasksTable.lexicalOrder} COLLATE "C"`);
const projectOrder = asc(sql`${projectsTable.lexicalOrder} COLLATE "C"`);
const sectionOrder = asc(sql`${sectionsTable.lexicalOrder} COLLATE "C"`);

const nullableEq = <TColumn>(column: TColumn, value: string | null) =>
  value === null ? isNull(column as never) : eq(column as never, value);

const findSiblingOrder = async (
  db: ReturnType<typeof drizzle>,
  parentId: TaskId | null,
  projectId: ProjectId | null,
  sectionId: SectionId | null,
  beforeId: TaskId | null,
  afterId: TaskId | null
) => {
  const siblings = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        nullableEq(tasksTable.parentId, parentId),
        nullableEq(tasksTable.projectId, projectId),
        nullableEq(tasksTable.sectionId, sectionId)
      )
    )
    .orderBy(rowOrder);
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

const collectDescendantIds = async (db: ReturnType<typeof drizzle>, id: TaskId): Promise<ReadonlyArray<TaskId>> => {
  const children = await db.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.parentId, id));
  const descendantIds = await Promise.all(children.map((child) => collectDescendantIds(db, child.id)));

  return Object.freeze([id, ...descendantIds.flat()]);
};

const firstTask = (rows: ReadonlyArray<TaskRow>) => (rows[0] === undefined ? null : toTask(rows[0]));
const firstProject = (rows: ReadonlyArray<ProjectRow>) => (rows[0] === undefined ? null : toProject(rows[0]));
const firstSection = (rows: ReadonlyArray<SectionRow>) => (rows[0] === undefined ? null : toSection(rows[0]));

export const createPostgresTaskRepository = (databaseUrl: string): TaskRepository => {
  const client = postgres(databaseUrl, { max: 10 });
  const db = drizzle(client);

  return Object.freeze({
    list: async () => {
      const rows = await db.select().from(tasksTable).orderBy(rowOrder);

      return Object.freeze(rows.map(toTask));
    },
    listProjects: async () => {
      const rows = await db.select().from(projectsTable).orderBy(projectOrder);

      return Object.freeze(rows.map(toProject));
    },
    createProject: async (title) => {
      const siblings = await db.select().from(projectsTable).orderBy(projectOrder);
      const rows = await db
        .insert(projectsTable)
        .values({
          id: crypto.randomUUID(),
          title,
          lexicalOrder: generateLexicalOrder(siblings.at(-1)?.lexicalOrder ?? null, null)
        })
        .returning();
      const project = firstProject(rows);

      if (project === null) {
        throw new Error("Project insert failed");
      }

      return project;
    },
    updateProject: async (id, title) => {
      const rows = await db
        .update(projectsTable)
        .set({
          title,
          updatedAt: new Date()
        })
        .where(eq(projectsTable.id, id))
        .returning();

      return firstProject(rows);
    },
    deleteProject: async (id) => {
      const rows = await db
        .delete(projectsTable)
        .where(eq(projectsTable.id, id))
        .returning({ id: projectsTable.id });

      if (rows.length === 0) {
        return false;
      }

      const projectSections = await db.select({ id: sectionsTable.id }).from(sectionsTable).where(eq(sectionsTable.projectId, id));
      const sectionIds = Object.freeze(projectSections.map((section) => section.id));
      const doomedRoots = await db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(
          sectionIds.length > 0
            ? or(eq(tasksTable.projectId, id), inArray(tasksTable.sectionId, [...sectionIds]))
            : eq(tasksTable.projectId, id)
        );
      const doomedIds = Object.freeze(
        [...new Set((await Promise.all(doomedRoots.map((row) => collectDescendantIds(db, row.id)))).flat())]
      );

      if (doomedIds.length > 0) {
        await db.delete(tasksTable).where(inArray(tasksTable.id, [...doomedIds]));
      }

      await db.delete(sectionsTable).where(eq(sectionsTable.projectId, id));

      return true;
    },
    listSections: async () => {
      const rows = await db.select().from(sectionsTable).orderBy(sectionOrder);

      return Object.freeze(rows.map(toSection));
    },
    createSection: async (title, projectId) => {
      const siblings = await db
        .select()
        .from(sectionsTable)
        .where(nullableEq(sectionsTable.projectId, projectId))
        .orderBy(sectionOrder);
      const rows = await db
        .insert(sectionsTable)
        .values({
          id: crypto.randomUUID(),
          title,
          projectId,
          lexicalOrder: generateLexicalOrder(siblings.at(-1)?.lexicalOrder ?? null, null)
        })
        .returning();
      const section = firstSection(rows);

      if (section === null) {
        throw new Error("Section insert failed");
      }

      return section;
    },
    updateSection: async (id, title) => {
      const rows = await db
        .update(sectionsTable)
        .set({
          title,
          updatedAt: new Date()
        })
        .where(eq(sectionsTable.id, id))
        .returning();

      return firstSection(rows);
    },
    deleteSection: async (id) => {
      const rows = await db
        .delete(sectionsTable)
        .where(eq(sectionsTable.id, id))
        .returning({ id: sectionsTable.id });

      if (rows.length === 0) {
        return false;
      }

      await db
        .update(tasksTable)
        .set({
          parentId: null,
          sectionId: null,
          updatedAt: new Date()
        })
        .where(eq(tasksTable.sectionId, id));

      return true;
    },
    create: async (title, priority, parentId, projectId, sectionId) => {
      const id = crypto.randomUUID();
      const lexicalOrder = await findSiblingOrder(db, parentId, projectId, sectionId, null, null);
      const rows = await db
        .insert(tasksTable)
        .values({
          id,
          title,
          completed: false,
          priority,
          parentId,
          projectId,
          sectionId,
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

      const lexicalOrder = await findSiblingOrder(db, move.parentId, move.projectId, move.sectionId, move.beforeId, move.afterId);
      const rows = await db
        .update(tasksTable)
        .set({
          parentId: move.parentId,
          projectId: move.projectId,
          sectionId: move.sectionId,
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
