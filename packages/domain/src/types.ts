export type TaskId = string;
export type ProjectId = string;
export type SectionId = string;

export type Task = Readonly<{
  id: TaskId;
  title: string;
  description: string;
  dueDate: string | null;
  labels: ReadonlyArray<string>;
  comments: ReadonlyArray<Readonly<{ id: string; body: string; createdAt: string }>>;
  completed: boolean;
  parentId: TaskId | null;
  projectId: ProjectId | null;
  sectionId: SectionId | null;
  lexicalOrder: string;
  createdAt: string;
  updatedAt: string;
}>;

export type TaskNode = Task & Readonly<{
  children: ReadonlyArray<TaskNode>;
}>;

export type Project = Readonly<{
  id: ProjectId;
  title: string;
  description: string;
  archived: boolean;
  lexicalOrder: string;
  createdAt: string;
  updatedAt: string;
}>;

export type Section = Readonly<{
  id: SectionId;
  title: string;
  projectId: ProjectId | null;
  lexicalOrder: string;
  createdAt: string;
  updatedAt: string;
}>;
