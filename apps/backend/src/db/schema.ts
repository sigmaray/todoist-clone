import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey(),
  confirmDelete: boolean("confirm_delete").notNull().default(true),
  accessMode: text("access_mode").notNull().default("anonymous"),
  username: text("username"),
  passwordHash: text("password_hash"),
  inboxDescription: text("inbox_description").notNull().default("")
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
});

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  archived: boolean("archived").notNull().default(false),
  parentId: text("parent_id"),
  lexicalOrder: text("lexical_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const sections = pgTable("sections", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  projectId: text("project_id"),
  lexicalOrder: text("lexical_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  dueDate: text("due_date"),
  labels: text("labels").array().notNull().default([]),
  comments: jsonb("comments").notNull().default([]),
  completed: boolean("completed").notNull().default(false),
  parentId: text("parent_id"),
  projectId: text("project_id"),
  sectionId: text("section_id"),
  lexicalOrder: text("lexical_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
