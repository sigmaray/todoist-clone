import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createPostgresTaskRepository } from "./db/repository";
import { createPostgresSettingsRepository } from "./db/settings-repository";

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL ?? "postgres://todoist:todoist@127.0.0.1:5432/todoist";
const mode = process.env.NODE_ENV ?? "development";

serve({
  fetch: createApp(createPostgresTaskRepository(databaseUrl), {
    databaseUrl,
    mode,
    settingsRepository: createPostgresSettingsRepository(databaseUrl)
  }).fetch,
  port
});

console.log(`API listening on http://127.0.0.1:${port}`);
