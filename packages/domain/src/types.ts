export type TaskId = string;

export type Priority = 1 | 2 | 3 | 4;

export type Task = Readonly<{
  id: TaskId;
  title: string;
  completed: boolean;
  priority: Priority;
  parentId: TaskId | null;
  lexicalOrder: string;
  createdAt: string;
  updatedAt: string;
}>;

export type TaskNode = Task & Readonly<{
  children: ReadonlyArray<TaskNode>;
}>;
