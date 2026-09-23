# AI Agent System Prompt & Architecture Rules

## Project Overview
Self-hosted Todoist clone (MVP). A fast, hierarchical task manager with drag-and-drop capabilities, built for a single user.

## Core Paradigm: STRICT FUNCTIONAL PROGRAMMING
- **NO CLASSES, NO OOP, NO `this` keyword.** This is a hard rule.
- Use only pure functions, closures, and factory functions.
- All data structures must be immutable. Use `Readonly<T>`, `ReadonlyArray<T>`, and `Object.freeze()`.
- Do not use structural mutation. Return new objects/arrays.
- Use Discriminated Unions and Pattern Matching (via `switch` or functional libraries) instead of polymorphism.

## Tech Stack
- **Architecture:** Monorepo (pnpm workspaces).
  - `/packages/domain` - Shared types, business logic, pure functions.
  - `/apps/frontend` - React SPA.
  - `/apps/backend` - Node.js API.
- **Frontend:** React, Vite, TanStack Query (for server state & Optimistic UI), @dnd-kit (for tree drag-and-drop), Tailwind CSS.
- **Backend:** Hono (functional routing), Drizzle ORM (functional SQL builder, no Active Record), Zod (validation).
- **Database:** PostgreSQL.
- **Testing:** Vitest (Unit & API), Playwright (E2E). No class mocking.

## MVP Scope Constraints
- **Do NOT implement:** Authentication/users, recurring tasks, smart date NLP parsing, tags, collaboration features, activity logs.
- **DO implement:** Infinite nesting (Adjacency List `parentId`), task priorities (P1-P4), boolean completion status, drag-and-drop reordering.
- **Sorting Mechanism:** Use Lexical Sorting (Fractional Indexing) for drag-and-drop to avoid mass database updates. Save as `lexicalOrder` string field.

## Code Style
- Extract business logic (like tree building and lexical sorting) into pure functions inside `/packages/domain` so they can be unit-tested without DB or Framework context.
- UI state management relies heavily on React Query's `onMutate` for Optimistic Updates.
- E2E tests in Playwright must use functional helpers (closures), not Page Object Model classes.
