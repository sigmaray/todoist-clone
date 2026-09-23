import { describe, expect, it } from "vitest";
import { buildTaskTree, generateLexicalOrder } from "./pure";
import type { Task } from "./types";

const task = (values: Partial<Task> & Pick<Task, "id" | "title" | "lexicalOrder">): Task =>
  Object.freeze({
    completed: false,
    priority: 4,
    parentId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...values
  });

describe("buildTaskTree", () => {
  it("builds an immutable sorted task tree", () => {
    const tree = buildTaskTree([
      task({ id: "child-b", title: "Child B", parentId: "root", lexicalOrder: "b" }),
      task({ id: "root", title: "Root", lexicalOrder: "a" }),
      task({ id: "child-a", title: "Child A", parentId: "root", lexicalOrder: "a" })
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.children.map((child) => child.id)).toEqual(["child-a", "child-b"]);
    expect(Object.isFrozen(tree)).toBe(true);
    expect(Object.isFrozen(tree[0])).toBe(true);
    expect(Object.isFrozen(tree[0]?.children)).toBe(true);
  });
});

describe("generateLexicalOrder", () => {
  it("creates sortable values between neighbors", () => {
    const middle = generateLexicalOrder("A", "C");

    expect(middle > "A").toBe(true);
    expect(middle < "C").toBe(true);
  });

  it("creates values for empty ranges", () => {
    expect(generateLexicalOrder(null, null)).toBeTruthy();
    expect(generateLexicalOrder(null, "1") < "1").toBe(true);
    expect(generateLexicalOrder("z", null) > "z").toBe(true);
  });
});
