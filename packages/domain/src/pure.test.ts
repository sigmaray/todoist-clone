import { describe, expect, it } from "vitest";
import {
  buildTaskTree,
  computeDropPlacement,
  computeIndentPlacement,
  computeOutdentPlacement,
  generateLexicalOrder,
  renderTaskMarkdownDocument
} from "./pure";
import type { Task } from "./types";

const task = (values: Partial<Task> & Pick<Task, "id" | "title" | "lexicalOrder">): Task =>
  Object.freeze({
    completed: false,
    priority: 4,
    parentId: null,
    projectId: null,
    sectionId: null,
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

describe("computeDropPlacement", () => {
  const siblings = Object.freeze([
    task({ id: "a", title: "A", lexicalOrder: "a" }),
    task({ id: "b", title: "B", lexicalOrder: "b" }),
    task({ id: "c", title: "C", lexicalOrder: "c" })
  ]);

  it("places the moved task before or after the target", () => {
    expect(computeDropPlacement(siblings, siblings[1] as Task, siblings[0] as Task, "before")).toEqual(
      Object.freeze({ parentId: null, projectId: null, sectionId: null, beforeId: "a", afterId: null })
    );
    expect(computeDropPlacement(siblings, siblings[0] as Task, siblings[2] as Task, "after")).toEqual(
      Object.freeze({ parentId: null, projectId: null, sectionId: null, beforeId: null, afterId: "c" })
    );
  });

  it("returns null for no-op drops next to the current position", () => {
    expect(computeDropPlacement(siblings, siblings[0] as Task, siblings[1] as Task, "before")).toBeNull();
    expect(computeDropPlacement(siblings, siblings[1] as Task, siblings[0] as Task, "after")).toBeNull();
    expect(computeDropPlacement(siblings, siblings[1] as Task, siblings[1] as Task, "before")).toBeNull();
  });

  it("returns null when the target is a descendant of the moved task", () => {
    const tree = Object.freeze([
      task({ id: "root", title: "Root", lexicalOrder: "a" }),
      task({ id: "child", title: "Child", parentId: "root", lexicalOrder: "a" })
    ]);

    expect(computeDropPlacement(tree, tree[0] as Task, tree[1] as Task, "before")).toBeNull();
    expect(computeDropPlacement(tree, tree[0] as Task, tree[1] as Task, "after")).toBeNull();
  });
});

describe("computeIndentPlacement", () => {
  it("makes the task a child of the sibling above it", () => {
    const tasks = Object.freeze([
      task({ id: "a", title: "A", lexicalOrder: "a" }),
      task({ id: "b", title: "B", lexicalOrder: "b" })
    ]);

    expect(computeIndentPlacement(tasks, tasks[1] as Task)).toEqual(
      Object.freeze({ parentId: "a", projectId: null, sectionId: null, beforeId: null, afterId: null })
    );
  });

  it("returns null for the first sibling", () => {
    const tasks = Object.freeze([task({ id: "a", title: "A", lexicalOrder: "a" })]);

    expect(computeIndentPlacement(tasks, tasks[0] as Task)).toBeNull();
  });
});

describe("computeOutdentPlacement", () => {
  it("moves the task below its parent as a sibling", () => {
    const tasks = Object.freeze([
      task({ id: "parent", title: "Parent", lexicalOrder: "a" }),
      task({ id: "child", title: "Child", parentId: "parent", projectId: null, sectionId: null, lexicalOrder: "a" })
    ]);

    expect(computeOutdentPlacement(tasks, tasks[1] as Task)).toEqual(
      Object.freeze({ parentId: null, projectId: null, sectionId: null, beforeId: null, afterId: "parent" })
    );
  });

  it("returns null for root tasks", () => {
    const tasks = Object.freeze([task({ id: "a", title: "A", lexicalOrder: "a" })]);

    expect(computeOutdentPlacement(tasks, tasks[0] as Task)).toBeNull();
  });
});

describe("renderTaskMarkdownDocument", () => {
  it("renders nested tasks as a markdown checklist", () => {
    const tree = buildTaskTree([
      task({ id: "root", title: "Plan release", lexicalOrder: "a", completed: true, priority: 1 }),
      task({ id: "child", title: "Write notes", parentId: "root", lexicalOrder: "a" })
    ]);

    expect(renderTaskMarkdownDocument("Inbox", tree)).toBe(
      [
        "# Inbox",
        "",
        "- [x] Plan release (P1)",
        "  - [ ] Write notes (P4)",
        ""
      ].join("\n")
    );
  });
});
