# AI Agent System Prompt & Architecture Rules

## Project Overview
Self-hosted Todoist clone (MVP). A fast, hierarchical task manager with drag-and-drop capabilities, built for a single user.

## Core Paradigm: STRICT FUNCTIONAL PROGRAMMING
- **NO CLASSES, NO OOP, NO `this` keyword.** This is a hard rule.
- Use only pure functions, closures, and factory functions.
- All data structures must be immutable. Use `Readonly<T>`, `ReadonlyArray<T>`, and `Object.freeze()`.
- Prefer TypeScript `Readonly<T>`/`ReadonlyArray<T>` as the main immutability mechanism. Use runtime `Object.freeze()` only at useful boundaries (for example shared constants, returned trees, and test fixtures), and avoid ceremonial wrappers such as `freezeTask`/`freezeProject`/`freezeSection`; inline freezing at the creation boundary is clearer when runtime freezing is actually useful.
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
- **Testing:** 
  - Domain & Backend API: Vitest + Supertest. No class mocking.
  - Frontend UI: Vitest + React Testing Library (for basic component functionality).
  - E2E: Playwright.

## MVP Scope Constraints
- **Do NOT implement:** Recurring tasks, smart date NLP parsing, tags, collaboration features, activity logs.
- **DO implement:** User accounts with administrator-managed accounts and per-user task data, infinite nesting (Adjacency List `parentId`), task priorities (P1-P4), boolean completion status, drag-and-drop reordering.
- **Sorting Mechanism:** Use Lexical Sorting (Fractional Indexing) for drag-and-drop to avoid mass database updates. Save as `lexicalOrder` string field.

## Code Style
- Extract business logic (like tree building and lexical sorting) into pure functions inside `/packages/domain` so they can be unit-tested without DB or Framework context.
- UI state management relies heavily on React Query's `onMutate` for Optimistic Updates.
- Frontend basic functionality (rendering, state updates, event dispatching) MUST be verified via Unit Tests before moving to E2E.
- E2E tests in Playwright must use functional helpers (closures), not Page Object Model classes. E2E testing is a mandatory part of the MVP.

## Development Workflow
- **Every important change MUST update and run tests.** When you add or change behavior, update or add unit tests (domain, backend API, frontend components) and E2E tests, then run the full suite (`pnpm test` for unit/integration and `pnpm test:e2e` for E2E) and make sure it is green before considering the work done. Do not report work as complete while any test is failing.
- **Maintain `MEMORY.md` at the repo root.** For each work session, append a short entry: date, what was done, key decisions, and the current state of the project. A new agent must read `MEMORY.md` first to rebuild context cheaply.
