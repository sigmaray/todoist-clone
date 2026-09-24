export type TaskId = string;
export type ProjectId = string;
export type SectionId = string;

export type Priority = 1 | 2 | 3 | 4;

export type Task = Readonly<{
  id: TaskId;
  title: string;
  completed: boolean;
  priority: Priority;
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
