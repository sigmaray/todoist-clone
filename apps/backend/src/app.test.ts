import { getRequestListener } from "@hono/node-server";
import { createServer } from "node:http";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createMemorySettingsRepository } from "./settings";
import { createMemoryTaskRepository } from "./repository";

const createTestServer = () => createServer(getRequestListener(createApp().fetch));

describe("POST /tasks", () => {
  it("creates a task", async () => {
    const response = await request(createTestServer())
      .post("/tasks")
      .send({ title: "Ship MVP", priority: 1 })
      .expect(201);

    expect(response.body.task).toMatchObject({
      title: "Ship MVP",
      priority: 1,
      completed: false,
      parentId: null
    });
    expect(response.body.task.id).toEqual(expect.any(String));
    expect(response.body.task.lexicalOrder).toEqual(expect.any(String));
  });

  it("updates and deletes a task", async () => {
    const agent = request(createTestServer());
    const createResponse = await agent.post("/tasks").send({ title: "Draft title" }).expect(201);
    const id = createResponse.body.task.id;

    await agent.patch(`/tasks/${id}`).send({ title: "Final title" }).expect(200);
    const listResponse = await agent.get("/tasks").expect(200);

    expect(listResponse.body.tasks[0].title).toBe("Final title");

    await agent.delete(`/tasks/${id}`).expect(200);
    const emptyResponse = await agent.get("/tasks").expect(200);

    expect(emptyResponse.body.tasks).toEqual([]);
  });

  it("creates projects, inbox sections, and moves tasks between them", async () => {
    const agent = request(createTestServer());
    const projectResponse = await agent.post("/projects").send({ title: "Roadmap" }).expect(201);
    const sectionResponse = await agent.post("/sections").send({ title: "Later" }).expect(201);
    const taskResponse = await agent.post("/tasks").send({ title: "Sort inbox" }).expect(201);

    await agent
      .put(`/tasks/${taskResponse.body.task.id}/move`)
      .send({
        parentId: null,
        projectId: projectResponse.body.project.id,
        sectionId: null,
        beforeId: null,
        afterId: null
      })
      .expect(200);

    const projectTasks = await agent.get("/tasks").expect(200);

    expect(projectTasks.body.tasks[0]).toMatchObject({
      title: "Sort inbox",
      projectId: projectResponse.body.project.id,
      sectionId: null
    });

    await agent
      .put(`/tasks/${taskResponse.body.task.id}/move`)
      .send({
        parentId: null,
        projectId: null,
        sectionId: sectionResponse.body.section.id,
        beforeId: null,
        afterId: null
      })
      .expect(200);

    const sectionTasks = await agent.get("/tasks").expect(200);

    expect(sectionTasks.body.tasks[0]).toMatchObject({
      projectId: null,
      sectionId: sectionResponse.body.section.id
    });
  });

  it("updates and deletes sections without deleting tasks", async () => {
    const agent = request(createTestServer());
    const sectionResponse = await agent.post("/sections").send({ title: "Later" }).expect(201);
    const taskResponse = await agent
      .post("/tasks")
      .send({ title: "Keep me", sectionId: sectionResponse.body.section.id })
      .expect(201);

    await agent.patch(`/sections/${sectionResponse.body.section.id}`).send({ title: "Soon" }).expect(200);

    const sections = await agent.get("/sections").expect(200);

    expect(sections.body.sections[0]).toMatchObject({ title: "Soon" });

    await agent.delete(`/sections/${sectionResponse.body.section.id}`).expect(200);

    const tasks = await agent.get("/tasks").expect(200);

    expect(tasks.body.tasks[0]).toMatchObject({
      id: taskResponse.body.task.id,
      title: "Keep me",
      sectionId: null,
      parentId: null
    });
  });

  it("updates and deletes projects, cascading to their sections and tasks", async () => {
    const agent = request(createTestServer());
    const projectResponse = await agent.post("/projects").send({ title: "Roadmap" }).expect(201);
    const projectId = projectResponse.body.project.id;
    const sectionResponse = await agent.post("/sections").send({ title: "Later", projectId }).expect(201);
    const sectionTaskResponse = await agent
      .post("/tasks")
      .send({ title: "In section", sectionId: sectionResponse.body.section.id })
      .expect(201);
    await agent
      .post("/tasks")
      .send({ title: "Subtask", parentId: sectionTaskResponse.body.task.id, sectionId: sectionResponse.body.section.id })
      .expect(201);

    await agent.patch(`/projects/${projectId}`).send({ title: "Roadmap 2" }).expect(200);

    const renamed = await agent.get("/projects").expect(200);

    expect(renamed.body.projects[0]).toMatchObject({ id: projectId, title: "Roadmap 2" });

    await agent.delete(`/projects/${projectId}`).expect(200);

    const projects = await agent.get("/projects").expect(200);
    const sections = await agent.get("/sections").expect(200);
    const tasks = await agent.get("/tasks").expect(200);

    expect(projects.body.projects).toEqual([]);
    expect(sections.body.sections).toEqual([]);
    expect(tasks.body.tasks).toEqual([]);
    expect(tasks.body.tree).toEqual([]);
  });

  it("returns 404 for unknown projects", async () => {
    const agent = request(createTestServer());

    await agent.patch("/projects/missing").send({ title: "Nope" }).expect(404);
    await agent.delete("/projects/missing").expect(404);
  });

  it("reorders tasks with beforeId and afterId", async () => {
    const agent = request(createTestServer());
    const create = async (title: string) => (await agent.post("/tasks").send({ title }).expect(201)).body.task as { id: string };

    const first = await create("First");
    const second = await create("Second");
    const third = await create("Third");

    await agent
      .put(`/tasks/${third.id}/move`)
      .send({ parentId: null, projectId: null, sectionId: null, beforeId: first.id, afterId: null })
      .expect(200);

    const reordered = await agent.get("/tasks").expect(200);

    expect(reordered.body.tree.map((task: { id: string }) => task.id)).toEqual([third.id, first.id, second.id]);

    await agent
      .put(`/tasks/${third.id}/move`)
      .send({ parentId: null, projectId: null, sectionId: null, beforeId: null, afterId: second.id })
      .expect(200);

    const finalOrder = await agent.get("/tasks").expect(200);

    expect(finalOrder.body.tree.map((task: { id: string }) => task.id)).toEqual([first.id, second.id, third.id]);
  });
});

describe("settings and session authentication", () => {
  it("defaults to delete confirmations and allows updating that preference", async () => {
    const settingsRepository = createMemorySettingsRepository();
    const server = createServer(getRequestListener(createApp(createMemoryTaskRepository(), { settingsRepository }).fetch));
    const agent = request.agent(server);

    await agent.get("/settings").expect(200).expect(({ body }) => {
      expect(body.settings).toEqual({ confirmDelete: true, accessMode: "anonymous", username: null });
    });
    await agent.put("/settings").send({ confirmDelete: false, accessMode: "anonymous", username: null }).expect(200);
    await agent.get("/settings").expect(200).expect(({ body }) => expect(body.settings.confirmDelete).toBe(false));
  });

  it("protects app routes with an HttpOnly session cookie when password access is enabled", async () => {
    const settingsRepository = createMemorySettingsRepository();
    const server = createServer(getRequestListener(createApp(createMemoryTaskRepository(), { settingsRepository }).fetch));
    const agent = request.agent(server);

    await agent
      .put("/settings")
      .send({ confirmDelete: true, accessMode: "password", username: "owner", password: "a-long-test-password" })
      .expect(200);
    await agent.get("/tasks").expect(401);
    await agent.post("/auth/login").send({ username: "owner", password: "wrong-password" }).expect(401);

    const login = await agent.post("/auth/login").send({ username: "owner", password: "a-long-test-password" }).expect(200);
    expect(login.headers["set-cookie"][0]).toMatch(/HttpOnly/);
    expect(login.headers["set-cookie"][0]).toMatch(/SameSite=Lax/i);
    await agent.get("/tasks").expect(200);
    await agent.get("/settings").expect(200);
    await agent.post("/auth/logout").expect(200);
    await agent.get("/tasks").expect(401);
  });

  it("requires a sufficiently long password before enabling login", async () => {
    const settingsRepository = createMemorySettingsRepository();
    const server = createServer(getRequestListener(createApp(createMemoryTaskRepository(), { settingsRepository }).fetch));

    await request(server)
      .put("/settings")
      .send({ confirmDelete: true, accessMode: "password", username: "owner", password: "short" })
      .expect(400);
  });
});
