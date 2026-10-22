export type AccessMode = "anonymous" | "password";

export type StoredSettings = Readonly<{
  confirmDelete: boolean;
  accessMode: AccessMode;
  username: string | null;
  passwordHash: string | null;
}>;

export type PublicSettings = Readonly<{
  confirmDelete: boolean;
  accessMode: AccessMode;
  username: string | null;
}>;

export type SettingsRepository = Readonly<{
  getSettings: () => Promise<StoredSettings>;
  saveSettings: (settings: StoredSettings) => Promise<void>;
  saveSession: (tokenHash: string, expiresAt: Date) => Promise<void>;
  hasSession: (tokenHash: string, now: Date) => Promise<boolean>;
  deleteSession: (tokenHash: string) => Promise<void>;
  deleteAllSessions: () => Promise<void>;
  getInboxDescription: () => Promise<string>;
  saveInboxDescription: (description: string) => Promise<void>;
}>;

export const defaultSettings: StoredSettings = Object.freeze({
  confirmDelete: true,
  accessMode: "anonymous",
  username: null,
  passwordHash: null
});

export const toPublicSettings = (settings: StoredSettings): PublicSettings =>
  Object.freeze({
    confirmDelete: settings.confirmDelete,
    accessMode: settings.accessMode,
    username: settings.username
  });

export const createMemorySettingsRepository = (initial: StoredSettings = defaultSettings): SettingsRepository => {
  let settings = initial;
  let inboxDescription = "";
  let sessions = Object.freeze([] as ReadonlyArray<Readonly<{ tokenHash: string; expiresAt: Date }>>);

  return Object.freeze({
    getSettings: async () => settings,
    saveSettings: async (nextSettings) => {
      settings = Object.freeze({ ...nextSettings });
    },
    saveSession: async (tokenHash, expiresAt) => {
      sessions = Object.freeze([...sessions.filter((session) => session.tokenHash !== tokenHash), Object.freeze({ tokenHash, expiresAt })]);
    },
    hasSession: async (tokenHash, now) => sessions.some((session) => session.tokenHash === tokenHash && session.expiresAt > now),
    deleteSession: async (tokenHash) => {
      sessions = Object.freeze(sessions.filter((session) => session.tokenHash !== tokenHash));
    },
    deleteAllSessions: async () => {
      sessions = Object.freeze([]);
    },
    getInboxDescription: async () => inboxDescription,
    saveInboxDescription: async (description) => { inboxDescription = description; }
  });
};
