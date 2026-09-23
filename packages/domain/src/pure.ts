import type { Task, TaskId, TaskNode } from "./types";

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const base = alphabet.length;
const firstDigit = alphabet[0] ?? "0";
const middleDigit = alphabet[Math.floor(base / 2)] ?? "V";

const compareTaskOrder = (left: Task, right: Task) =>
  left.lexicalOrder.localeCompare(right.lexicalOrder) || left.createdAt.localeCompare(right.createdAt);

const freezeNode = (task: Task, children: ReadonlyArray<TaskNode>): TaskNode =>
  Object.freeze({
    ...task,
    children: Object.freeze(children)
  });

export const buildTaskTree = (tasks: ReadonlyArray<Task>): ReadonlyArray<TaskNode> => {
  const buildChildren = (parentId: TaskId | null): ReadonlyArray<TaskNode> =>
    Object.freeze(
      tasks
        .filter((task) => task.parentId === parentId)
        .toSorted(compareTaskOrder)
        .map((task) => freezeNode(task, buildChildren(task.id)))
    );

  return buildChildren(null);
};

const charToValue = (char: string | undefined, fallback: number) =>
  char === undefined ? fallback : Math.max(0, alphabet.indexOf(char));

const valueToChar = (value: number) => alphabet[value] ?? middleDigit;

export const generateLexicalOrder = (before: string | null, after: string | null): string => {
  const left = before ?? "";
  const right = after ?? "";

  const findMiddle = (index: number, prefix: string): string => {
    const low = charToValue(left[index], -1);
    const high = charToValue(right[index], base);

    if (high - low > 1) {
      return `${prefix}${valueToChar(Math.floor((low + high) / 2))}`;
    }

    return findMiddle(index + 1, `${prefix}${left[index] ?? firstDigit}`);
  };

  return findMiddle(0, "");
};
