import type { Project, ProjectId, Section, SectionId, Task, TaskNode } from "@todoist-clonse/domain";

export type TaskApi = Readonly<{
  listTasks: () => Promise<ReadonlyArray<TaskNode>>;
  listProjects: () => Promise<ReadonlyArray<Project>>;
  createProject: (title: string) => Promise<Project>;
  listSections: () => Promise<ReadonlyArray<Section>>;
  createSection: (title: string, projectId: ProjectId | null) => Promise<Section>;
  createTask: (title: string, projectId: ProjectId | null, sectionId: SectionId | null) => Promise<Task>;
  patchTask: (id: string, completed: boolean) => Promise<Task>;
  updateTaskTitle: (id: string, title: string) => Promise<Task>;
  moveTask: (id: string, projectId: ProjectId | null, sectionId: SectionId | null) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;
}>;

export type ToolsApi = Readonly<{
  listTables: () => Promise<ReadonlyArray<string>>;
  clearTable: (table: string) => Promise<unknown>;
  dropAllTables: () => Promise<unknown>;
  migrate: () => Promise<unknown>;
  clearAllTables: () => Promise<unknown>;
  seed: () => Promise<unknown>;
  runQuery: (sql: string) => Promise<unknown>;
}>;

const readJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export const createTaskApi = (baseUrl = ""): TaskApi =>
  Object.freeze({
    listTasks: async () => {
      const data = await readJson<{ tree: ReadonlyArray<TaskNode> }>(await fetch(`${baseUrl}/tasks`));

      return data.tree;
    },
    listProjects: async () => {
      const data = await readJson<{ projects: ReadonlyArray<Project> }>(await fetch(`${baseUrl}/projects`));

      return data.projects;
    },
    createProject: async (title) => {
      const data = await postJson<{ project: Project }>(`${baseUrl}/projects`, { title });

      return data.project;
    },
    listSections: async () => {
      const data = await readJson<{ sections: ReadonlyArray<Section> }>(await fetch(`${baseUrl}/sections`));

      return data.sections;
    },
    createSection: async (title, projectId) => {
      const data = await postJson<{ section: Section }>(`${baseUrl}/sections`, { title, projectId });

      return data.section;
    },
    createTask: async (title, projectId, sectionId) => {
      const data = await readJson<{ task: Task }>(
        await fetch(`${baseUrl}/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, projectId, sectionId })
        })
      );

      return data.task;
    },
    moveTask: async (id, projectId, sectionId) => {
      const data = await readJson<{ task: Task }>(
        await fetch(`${baseUrl}/tasks/${id}/move`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentId: null,
            projectId,
            sectionId,
            beforeId: null,
            afterId: null
          })
        })
      );

      return data.task;
    },
    patchTask: async (id, completed) => {
      const data = await readJson<{ task: Task }>(
        await fetch(`${baseUrl}/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed })
        })
      );

      return data.task;
    },
    updateTaskTitle: async (id, title) => {
      const data = await readJson<{ task: Task }>(
        await fetch(`${baseUrl}/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title })
        })
      );

      return data.task;
    },
    deleteTask: async (id) => {
      await readJson<{ deleted: true }>(
        await fetch(`${baseUrl}/tasks/${id}`, {
          method: "DELETE"
        })
      );
    }
  });

const postJson = async <T>(url: string, body: unknown = Object.freeze({})): Promise<T> =>
  readJson<T>(
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  );

export const createToolsApi = (baseUrl = ""): ToolsApi =>
  Object.freeze({
    listTables: async () => {
      const data = await readJson<{ tables: ReadonlyArray<string> }>(await fetch(`${baseUrl}/tools-api/tables`));

      return data.tables;
    },
    clearTable: async (table) => postJson(`${baseUrl}/tools-api/clear-table`, { table }),
    dropAllTables: async () => postJson(`${baseUrl}/tools-api/drop-all`),
    migrate: async () => postJson(`${baseUrl}/tools-api/migrate`),
    clearAllTables: async () => postJson(`${baseUrl}/tools-api/clear-all`),
    seed: async () => postJson(`${baseUrl}/tools-api/seed`),
    runQuery: async (sql) => postJson(`${baseUrl}/tools-api/query`, { sql })
  });
