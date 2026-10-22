import { and, eq, gt, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { appSettings, sessions } from "./schema";
import type { SettingsRepository, StoredSettings } from "../settings";

const singletonId = "app";

export const createPostgresSettingsRepository = (databaseUrl: string): SettingsRepository => {
  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql);

  return Object.freeze({
    getSettings: async () => {
      let rows = await db.select().from(appSettings).where(eq(appSettings.id, singletonId)).limit(1);

      if (rows[0] === undefined) {
        await db.insert(appSettings).values({ id: singletonId }).onConflictDoNothing();
        rows = await db.select().from(appSettings).where(eq(appSettings.id, singletonId)).limit(1);
      }

      const row = rows[0];

      if (row === undefined) {
        return Object.freeze({ confirmDelete: true, accessMode: "anonymous" as const, username: null, passwordHash: null });
      }

      return Object.freeze({
        confirmDelete: row.confirmDelete,
        accessMode: row.accessMode === "password" ? ("password" as const) : ("anonymous" as const),
        username: row.username,
        passwordHash: row.passwordHash
      });
    },
    saveSettings: async (settings: StoredSettings) => {
      await db
        .insert(appSettings)
        .values({ id: singletonId, ...settings })
        .onConflictDoUpdate({
          target: appSettings.id,
          set: {
            confirmDelete: settings.confirmDelete,
            accessMode: settings.accessMode,
            username: settings.username,
            passwordHash: settings.passwordHash
          }
        });
    },
    saveSession: async (tokenHash, expiresAt) => {
      await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
      await db.insert(sessions).values({ tokenHash, expiresAt }).onConflictDoUpdate({
        target: sessions.tokenHash,
        set: { expiresAt }
      });
    },
    hasSession: async (tokenHash, now) => {
      const rows = await db
        .select({ tokenHash: sessions.tokenHash })
        .from(sessions)
        .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
        .limit(1);

      return rows.length > 0;
    },
    deleteSession: async (tokenHash) => {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },
    deleteAllSessions: async () => {
      await db.delete(sessions);
    }
  });
};
