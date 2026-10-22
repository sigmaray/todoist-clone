import { buildTaskTree } from "@todoist-clonse/domain";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { createMemoryTaskRepository } from "./repository";
import type { TaskRepository } from "./repository";
import { createToolsRouter } from "./tools";

const prioritySchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

const createTaskSchema = z.object({
  title: z.string().trim().min(1),
  priority: prioritySchema.default(4),
  parentId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  sectionId: z.string().nullable().default(null)
});

const patchTaskSchema = z.object({
  title: z.string().trim().min(1).optional(),
  completed: z.boolean().optional(),
  priority: prioritySchema.optional(),
  projectId: z.string().nullable().optional(),
  sectionId: z.string().nullable().optional()
});

const moveTaskSchema = z.object({
  parentId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  sectionId: z.string().nullable().default(null),
  beforeId: z.string().nullable().default(null),
  afterId: z.string().nullable().default(null)
});

const createProjectSchema = z.object({
  title: z.string().trim().min(1)
});

const patchProjectSchema = z.object({
  title: z.string().trim().min(1)
});

const createSectionSchema = z.object({
  title: z.string().trim().min(1),
  projectId: z.string().nullable().default(null)
});

const patchSectionSchema = z.object({
  title: z.string().trim().min(1)
});

const parseJson = async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return {};
  }

  return request.json();
};

export const createApp = (
  repository: TaskRepository = createMemoryTaskRepository(),
  options: Readonly<{ databaseUrl?: string; mode?: string }> = Object.freeze({})
) => {
  const app = new Hono();

  app.use("*", cors());

  if (options.databaseUrl !== undefined) {
    app.route("/tools-api", createToolsRouter(options.databaseUrl, options.mode ?? "development"));
  }

  app.get("/tasks", async (context) => {
    const tasks = await repository.list();

    return context.json({ tasks, tree: buildTaskTree(tasks) });
  });

  app.get("/projects", async (context) => {
    const projects = await repository.listProjects();

    return context.json({ projects });
  });

  app.post("/projects", async (context) => {
    const result = createProjectSchema.safeParse(await parseJson(context.req.raw));

    if (!result.success) {
      return context.json({ error: "Invalid project payload" }, 400);
    }

    const project = await repository.createProject(result.data.title);

    return context.json({ project }, 201);
  });

  app.patch("/projects/:id", async (context) => {
    const result = patchProjectSchema.safeParse(await parseJson(context.req.raw));

    if (!result.success) {
      return context.json({ error: "Invalid project patch" }, 400);
    }

    const project = await repository.updateProject(context.req.param("id"), result.data.title);

    return project === null ? context.json({ error: "Project not found" }, 404) : context.json({ project });
  });

  app.delete("/projects/:id", async (context) => {
    const deleted = await repository.deleteProject(context.req.param("id"));

    return deleted ? context.json({ deleted: true }) : context.json({ error: "Project not found" }, 404);
  });

  app.get("/sections", async (context) => {
    const sections = await repository.listSections();

    return context.json({ sections });
  });

  app.post("/sections", async (context) => {
    const result = createSectionSchema.safeParse(await parseJson(context.req.raw));

    if (!result.success) {
      return context.json({ error: "Invalid section payload" }, 400);
    }

    const section = await repository.createSection(result.data.title, result.data.projectId);

    return context.json({ section }, 201);
  });

  app.patch("/sections/:id", async (context) => {
    const result = patchSectionSchema.safeParse(await parseJson(context.req.raw));

    if (!result.success) {
      return context.json({ error: "Invalid section patch" }, 400);
    }

    const section = await repository.updateSection(context.req.param("id"), result.data.title);

    return section === null ? context.json({ error: "Section not found" }, 404) : context.json({ section });
  });

  app.delete("/sections/:id", async (context) => {
    const deleted = await repository.deleteSection(context.req.param("id"));

    return deleted ? context.json({ deleted: true }) : context.json({ error: "Section not found" }, 404);
  });

  app.post("/tasks", async (context) => {
    const result = createTaskSchema.safeParse(await parseJson(context.req.raw));

    if (!result.success) {
      return context.json({ error: "Invalid task payload" }, 400);
    }

    const task = await repository.create(
      result.data.title,
      result.data.priority,
      result.data.parentId,
      result.data.projectId,
      result.data.sectionId
    );

    return context.json({ task }, 201);
  });

  app.patch("/tasks/:id", async (context) => {
    const result = patchTaskSchema.safeParse(await parseJson(context.req.raw));

    if (!result.success) {
      return context.json({ error: "Invalid task patch" }, 400);
    }

    const task = await repository.patch(context.req.param("id"), result.data);

    return task === null ? context.json({ error: "Task not found" }, 404) : context.json({ task });
  });

  app.put("/tasks/:id/move", async (context) => {
    const result = moveTaskSchema.safeParse(await parseJson(context.req.raw));

    if (!result.success) {
      return context.json({ error: "Invalid task move" }, 400);
    }

    const task = await repository.move(context.req.param("id"), result.data);

    return task === null ? context.json({ error: "Task not found" }, 404) : context.json({ task });
  });

  app.delete("/tasks/:id", async (context) => {
    const deleted = await repository.delete(context.req.param("id"));

    return deleted ? context.json({ deleted: true }) : context.json({ error: "Task not found" }, 404);
  });

  return app;
};
