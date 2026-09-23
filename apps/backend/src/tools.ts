import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import postgres from "postgres";
import { z } from "zod";

const tableSchema = z.object({
  table: z.string().trim().min(1)
});

const querySchema = z.object({
  sql: z.string().trim().min(1)
});

const tableNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

const quoteIdentifier = (name: string) => {
  if (!tableNamePattern.test(name)) {
    throw new Error("Invalid table name");
  }

  return `"${name}"`;
};

const migrationFile = new URL("../drizzle/0000_create_tasks.sql", import.meta.url);

const seedTasks = Object.freeze([
  Object.freeze({
    id: "seed-inbox",
    title: "Review seeded task",
    priority: 2,
    parentId: null,
    lexicalOrder: "U"
  }),
  Object.freeze({
    id: "seed-child",
    title: "Nested seeded task",
    priority: 3,
    parentId: "seed-inbox",
    lexicalOrder: "U"
  })
]);

const parseJson = async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return {};
  }

  return request.json();
};

const listTables = async (sql: postgres.Sql) =>
  sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;

const clearTable = async (sql: postgres.Sql, table: string) => {
  await sql.unsafe(`TRUNCATE TABLE ${quoteIdentifier(table)} RESTART IDENTITY CASCADE`);

  return Object.freeze({ table });
};

const clearAllTables = async (sql: postgres.Sql) => {
  const tables = await listTables(sql);

  await Promise.all(tables.map((table) => clearTable(sql, table.table_name)));

  return Object.freeze({ tables: Object.freeze(tables.map((table) => table.table_name)) });
};

const dropAllTables = async (sql: postgres.Sql) => {
  await sql`
    DO $$
    DECLARE item RECORD;
    BEGIN
      FOR item IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', item.tablename);
      END LOOP;
    END $$;
  `;
};

const migrate = async (sql: postgres.Sql) => {
  const migrationSql = await readFile(migrationFile, "utf8");

  await sql.unsafe(migrationSql);
};

const seed = async (sql: postgres.Sql) => {
  await migrate(sql);
  await Promise.all(
    seedTasks.map((task) =>
      sql`
        INSERT INTO tasks (id, title, completed, priority, parent_id, lexical_order)
        VALUES (${task.id}, ${task.title}, false, ${task.priority}, ${task.parentId}, ${task.lexicalOrder})
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          completed = EXCLUDED.completed,
          priority = EXCLUDED.priority,
          parent_id = EXCLUDED.parent_id,
          lexical_order = EXCLUDED.lexical_order,
          updated_at = now()
      `
    )
  );

  return Object.freeze({ inserted: seedTasks.length });
};

export const createToolsRouter = (databaseUrl: string, mode: string) => {
  const router = new Hono();
  const enabled = mode !== "production";
  const sql = postgres(databaseUrl, { max: 1 });

  router.use("*", async (context, next) => {
    if (!enabled) {
      return context.json({ error: "Tools are disabled" }, 404);
    }

    return next();
  });

  router.get("/tables", async (context) => {
    const tables = await listTables(sql);

    return context.json({ tables: tables.map((table) => table.table_name) });
  });

  router.post("/clear-table", async (context) => {
    const result = tableSchema.safeParse(await parseJson(context.req.raw));

    if (!result.success) {
      return context.json({ error: "Invalid table payload" }, 400);
    }

    const cleared = await clearTable(sql, result.data.table);

    return context.json({ cleared });
  });

  router.post("/clear-all", async (context) => {
    const cleared = await clearAllTables(sql);

    return context.json({ cleared });
  });

  router.post("/drop-all", async (context) => {
    await dropAllTables(sql);

    return context.json({ dropped: true });
  });

  router.post("/migrate", async (context) => {
    await migrate(sql);

    return context.json({ migrated: true });
  });

  router.post("/seed", async (context) => {
    const seeded = await seed(sql);

    return context.json({ seeded });
  });

  router.post("/query", async (context) => {
    const result = querySchema.safeParse(await parseJson(context.req.raw));

    if (!result.success) {
      return context.json({ error: "Invalid query payload" }, 400);
    }

    const rows = await sql.unsafe(result.data.sql);

    return context.json({
      rows: Array.isArray(rows) ? rows : [],
      count: Array.isArray(rows) ? rows.length : 0
    });
  });

  return router;
};
