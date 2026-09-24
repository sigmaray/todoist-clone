# Todoist Clonse

Self-hosted Todoist-style task manager MVP. The project is a pnpm monorepo with a pure functional domain package, a Hono backend, and a React/Vite frontend.

## English

### What Is Included

- Infinite task nesting with `parentId`.
- Task priorities from P1 to P4.
- Boolean completion status.
- Lexical ordering field for future drag-and-drop reordering.
- Domain logic extracted into pure functions in `packages/domain`.
- Backend API in `apps/backend`.
- Frontend SPA in `apps/frontend`.
- Unit, integration, UI, and E2E test setup.

### Project Structure

```text
packages/domain   Pure types and task helpers
apps/backend      Hono API, Drizzle schema, backend tests
apps/frontend     React + Vite app, TanStack Query, UI tests
e2e               Playwright tests
```

### Requirements

- Node.js 22+
- pnpm 11+
- PostgreSQL 14+
- Task, optional but recommended: https://taskfile.dev

### Setup

```bash
pnpm install
cp .env.example .env
```

The backend uses this default database URL when one is not provided:

```bash
postgres://todoist:todoist@localhost:5432/todoist
```

### Development

```bash
task backend
task frontend
task dev:docker
```

Or with pnpm directly:

```bash
pnpm dev:backend
pnpm dev:frontend
```

The development and test environments expose database tools at:

```text
http://127.0.0.1:5173/tools/
```

The tools page is disabled in production mode.

### Tests

```bash
task test
task test:unit
task test:docker
task test:docker:app
pnpm test:e2e
```

### Database Tasks

The Taskfile supports these variables:

```bash
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=todoist
DB_PASSWORD=todoist
DB_NAME=todoist
DATABASE_URL=postgres://todoist:todoist@127.0.0.1:5432/todoist
```

Create the database:

```bash
task db:create
```

Drop all tables in the database:

```bash
task db:drop-tables
```

Run Drizzle migrations:

```bash
task db:migrate
```

## Русский

### Что Уже Есть

- Бесконечная вложенность задач через `parentId`.
- Приоритеты задач от P1 до P4.
- Булев статус выполнения.
- Поле лексической сортировки для будущего drag-and-drop.
- Доменная логика вынесена в чистые функции в `packages/domain`.
- Backend API в `apps/backend`.
- Frontend SPA в `apps/frontend`.
- Настроены unit, integration, UI и E2E тесты.

### Структура Проекта

```text
packages/domain   Чистые типы и функции для задач
apps/backend      Hono API, Drizzle schema, backend-тесты
apps/frontend     React + Vite, TanStack Query, UI-тесты
e2e               Playwright-тесты
```

### Требования

- Node.js 22+
- pnpm 11+
- PostgreSQL 14+
- Task, опционально, но удобно: https://taskfile.dev

### Установка

```bash
pnpm install
cp .env.example .env
```

Если `DATABASE_URL` не задан, backend использует адрес по умолчанию:

```bash
postgres://todoist:todoist@localhost:5432/todoist
```

### Разработка

```bash
task backend
task frontend
task dev:docker
```

В development и test окружениях доступны инструменты базы данных:

```text
http://127.0.0.1:5173/tools/
```

В production режиме страница инструментов отключена.

Или напрямую через pnpm:

```bash
pnpm dev:backend
pnpm dev:frontend
```

### Тесты

```bash
task test
task test:unit
task test:docker
task test:docker:app
pnpm test:e2e
```

### Команды Для Базы Данных

Taskfile поддерживает эти переменные:

```bash
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=todoist
DB_PASSWORD=todoist
DB_NAME=todoist
DATABASE_URL=postgres://todoist:todoist@127.0.0.1:5432/todoist
```

Создать базу данных:

```bash
task db:create
```

Удалить все таблицы в базе:

```bash
task db:drop-tables
```

Запустить Drizzle-миграции:

```bash
task db:migrate
```
