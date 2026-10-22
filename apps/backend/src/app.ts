import { buildTaskTree } from "@todoist-clone/domain";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { createSessionToken, hashPassword, hashSessionToken, sessionCookieName, sessionLifetimeSeconds, verifyPassword } from "./auth";
import { createMemoryTaskRepository } from "./repository";
import type { TaskRepository } from "./repository";
import { createMemorySettingsRepository, toPublicSettings } from "./settings";
import type { SettingsRepository } from "./settings";
import { createToolsRouter } from "./tools";

const createTaskSchema = z.object({
  title: z.string().trim().min(1),
  parentId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  sectionId: z.string().nullable().default(null)
});

const patchTaskSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().max(20000).optional(),
  dueDate: z.string().date().nullable().optional(),
  labels: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  comments: z.array(z.object({ id: z.string(), body: z.string().min(1).max(5000), createdAt: z.string() })).optional(),
  completed: z.boolean().optional(),
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
  title: z.string().trim().min(1),
  parentId: z.string().nullable().default(null)
});
const moveProjectSchema = z.object({ parentId: z.string().nullable() });

const patchProjectSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().max(20000).optional()
}).refine((patch) => patch.title !== undefined || patch.description !== undefined);

const reorderProjectSchema = z.object({ beforeId: z.string().nullable(), afterId: z.string().nullable() });
const reorderSectionSchema = reorderProjectSchema;

const createSectionSchema = z.object({
  title: z.string().trim().min(1),
  projectId: z.string().nullable().default(null)
});

const patchSectionSchema = z.object({
  title: z.string().trim().min(1)
});

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256)
});

const updateSettingsSchema = z.object({
  confirmDelete: z.boolean(),
  accessMode: z.enum(["anonymous", "password"]),
  username: z.string().trim().min(1).max(64).nullable().optional(),
  password: z.string().min(12).max(128).optional()
});
const inboxDescriptionSchema = z.object({ description: z.string().max(20000) });

const parseJson = async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return {};
  }

  return request.json();
};

export const createApp = (
  repository: TaskRepository = createMemoryTaskRepository(),
  options: Readonly<{ databaseUrl?: string; mode?: string; settingsRepository?: SettingsRepository }> = Object.freeze({})
) => {
  const app = new Hono();
  const settingsRepository = options.settingsRepository ?? createMemorySettingsRepository();
  const secureCookies = options.mode === "production";

  app.use("*", cors());

  app.use("*", async (context, next) => {
    const path = context.req.path;
    const method = context.req.method;
    const publicRoute = (path === "/auth/status" && method === "GET") || (path === "/auth/login" && method === "POST") || (path === "/auth/logout" && method === "POST");

    if (publicRoute || method === "OPTIONS") {
      await next();
      return;
    }

    const settings = await settingsRepository.getSettings();

    if (settings.accessMode === "anonymous") {
      await next();
      return;
    }

    const token = getCookie(context, sessionCookieName);
    const valid = token === undefined ? false : await settingsRepository.hasSession(hashSessionToken(token), new Date());

    if (!valid) {
      return context.json({ error: "Authentication required" }, 401);
    }

    await next();
  });

  app.get("/auth/status", async (context) => {
    const settings = await settingsRepository.getSettings();
    const token = getCookie(context, sessionCookieName);
    const authenticated = settings.accessMode === "anonymous" || (token !== undefined && (await settingsRepository.hasSession(hashSessionToken(token), new Date())));

    context.header("Cache-Control", "no-store");
    return context.json({ accessMode: settings.accessMode, authenticated });
  });

  app.post("/auth/login", async (context) => {
    const result = loginSchema.safeParse(await parseJson(context.req.raw));
    const settings = await settingsRepository.getSettings();

    if (!result.success || settings.accessMode !== "password" || settings.username === null || settings.passwordHash === null) {
      return context.json({ error: "Invalid username or password" }, 401);
    }

    const validPassword = await verifyPassword(result.data.password, settings.passwordHash);

    if (result.data.username !== settings.username || !validPassword) {
      return context.json({ error: "Invalid username or password" }, 401);
    }

    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + sessionLifetimeSeconds * 1000);

    await settingsRepository.saveSession(tokenHash, expiresAt);
    setCookie(context, sessionCookieName, token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "Lax",
      path: "/",
      maxAge: sessionLifetimeSeconds
    });
    context.header("Cache-Control", "no-store");

    return context.json({ authenticated: true });
  });

  app.post("/auth/logout", async (context) => {
    const token = getCookie(context, sessionCookieName);

    if (token !== undefined) {
      await settingsRepository.deleteSession(hashSessionToken(token));
    }

    deleteCookie(context, sessionCookieName, { httpOnly: true, secure: secureCookies, sameSite: "Lax", path: "/" });
    return context.json({ authenticated: false });
  });

  app.get("/settings", async (context) => {
    context.header("Cache-Control", "no-store");
    return context.json({ settings: toPublicSettings(await settingsRepository.getSettings()) });
  });

  app.put("/settings", async (context) => {
    const result = updateSettingsSchema.safeParse(await parseJson(context.req.raw));

    if (!result.success) {
      return context.json({ error: "Invalid settings" }, 400);
    }

    const current = await settingsRepository.getSettings();
    const username = result.data.username === undefined ? current.username : result.data.username;
    const passwordHash = result.data.password === undefined ? current.passwordHash : await hashPassword(result.data.password);

    if (result.data.accessMode === "password" && (username === null || passwordHash === null)) {
      return context.json({ error: "Set a username and a password before enabling login" }, 400);
    }

    const settings = Object.freeze({
      confirmDelete: result.data.confirmDelete,
      accessMode: result.data.accessMode,
      username,
      passwordHash
    });
    const credentialsChanged = username !== current.username || passwordHash !== current.passwordHash;

    await settingsRepository.saveSettings(settings);

    if (settings.accessMode === "anonymous" || credentialsChanged) {
      await settingsRepository.deleteAllSessions();
    }

    context.header("Cache-Control", "no-store");
    return context.json({ settings: toPublicSettings(settings) });
  });

  app.get("/inbox/description", async (context) => context.json({ description: await settingsRepository.getInboxDescription() }));
  app.put("/inbox/description", async (context) => {
    const result = inboxDescriptionSchema.safeParse(await parseJson(context.req.raw));
    if (!result.success) return context.json({ error: "Invalid Inbox description" }, 400);
    await settingsRepository.saveInboxDescription(result.data.description);
    return context.json({ description: result.data.description });
  });

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

    if (result.data.parentId !== null && !(await repository.listProjects()).some((project) => project.id === result.data.parentId)) return context.json({ error: "Parent project not found" }, 404);
    const project = result.data.parentId === null ? await repository.createProject(result.data.title) : await repository.createSubproject(result.data.title, result.data.parentId);

    return context.json({ project }, 201);
  });

  app.patch("/projects/:id/parent", async (context) => {
    const result = moveProjectSchema.safeParse(await parseJson(context.req.raw));
    if (!result.success) return context.json({ error: "Invalid project parent" }, 400);
    if (result.data.parentId !== null && !(await repository.listProjects()).some((project) => project.id === result.data.parentId)) return context.json({ error: "Parent project not found" }, 404);
    const project = await repository.moveProject(context.req.param("id"), result.data.parentId);
    return project === null ? context.json({ error: "Project not found or invalid parent" }, 404) : context.json({ project });
  });

  app.patch("/projects/:id", async (context) => {
    const result = patchProjectSchema.safeParse(await parseJson(context.req.raw));

    if (!result.success) {
      return context.json({ error: "Invalid project patch" }, 400);
    }

    const project = await repository.updateProject(context.req.param("id"), result.data);

    return project === null ? context.json({ error: "Project not found" }, 404) : context.json({ project });
  });

  app.patch("/projects/:id/order", async (context) => {
    const result = reorderProjectSchema.safeParse(await parseJson(context.req.raw));
    if (!result.success) return context.json({ error: "Invalid project order" }, 400);
    const project = await repository.reorderProject(context.req.param("id"), result.data.beforeId, result.data.afterId);
    return project === null ? context.json({ error: "Project not found" }, 404) : context.json({ project });
  });

  app.post("/projects/:id/duplicate", async (context) => {
    const project = await repository.duplicateProject(context.req.param("id"));
    return project === null ? context.json({ error: "Project not found" }, 404) : context.json({ project }, 201);
  });

  app.patch("/projects/:id/archive", async (context) => {
    const result = z.object({ archived: z.boolean() }).safeParse(await parseJson(context.req.raw));
    if (!result.success) return context.json({ error: "Invalid archive state" }, 400);
    const project = await repository.setProjectArchived(context.req.param("id"), result.data.archived);
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

  app.patch("/sections/:id/order", async (context) => {
    const result = reorderSectionSchema.safeParse(await parseJson(context.req.raw));
    if (!result.success) return context.json({ error: "Invalid section order" }, 400);
    const section = await repository.reorderSection(context.req.param("id"), result.data.beforeId, result.data.afterId);
    return section === null ? context.json({ error: "Section not found" }, 404) : context.json({ section });
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
