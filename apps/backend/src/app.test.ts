import { getRequestListener } from "@hono/node-server";
import { createServer } from "node:http";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

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
});
