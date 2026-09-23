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
});
