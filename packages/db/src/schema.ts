import { sql } from "drizzle-orm";
import { pgTable, text, jsonb, uniqueIndex, index, primaryKey, timestamp, boolean } from "drizzle-orm/pg-core";

export const channels = pgTable("channels", {
  instanceId: text("instance_id").notNull(),
  owner: text("owner").notNull(),
  type: text("type").notNull(),
  config: jsonb("config").notNull(),
}, (table) => [
  uniqueIndex("channels_instance_type_idx").on(table.instanceId, table.type),
  uniqueIndex("channels_slack_channel_unique_idx")
    .on(sql`(${table.config}->>'slackChannelId')`)
    .where(sql`${table.type} = 'slack'`),
]);

export const identityLinks = pgTable("identity_links", {
  provider: text("provider").notNull(),
  externalUserId: text("external_user_id").notNull(),
  keycloakSub: text("keycloak_sub").notNull(),
  refreshToken: text("refresh_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.provider, table.externalUserId] }),
]);

export const allowedUsers = pgTable("allowed_users", {
  instanceId: text("instance_id").notNull(),
  owner: text("owner").notNull(),
  keycloakSub: text("keycloak_sub").notNull(),
}, (table) => [
  primaryKey({ columns: [table.instanceId, table.keycloakSub] }),
]);

export const telegramThreads = pgTable("telegram_threads", {
  instanceId: text("instance_id").notNull(),
  threadId: text("thread_id").notNull(),
  authorizedBy: text("authorized_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.instanceId, table.threadId] }),
]);

export const sessions = pgTable("sessions", {
  sessionId: text("session_id").primaryKey(),
  instanceId: text("instance_id").notNull(),
  type: text("type").notNull().default("regular"),
  scheduleId: text("schedule_id"),
  scheduleActive: boolean("schedule_active").default(true).notNull(),
  threadTs: text("thread_ts"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("sessions_instance_thread_idx")
    .on(table.instanceId, table.threadTs)
    .where(sql`${table.threadTs} IS NOT NULL`),
]);

export const skillSources = pgTable("skill_sources", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  gitUrl: text("git_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("skill_sources_owner_git_url_idx").on(table.owner, table.gitUrl),
  index("skill_sources_owner_idx").on(table.owner),
]);

export const instanceSkills = pgTable("instance_skills", {
  instanceId: text("instance_id").notNull(),
  source: text("source").notNull(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  contentHash: text("content_hash"),
  installedAt: timestamp("installed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.instanceId, table.source, table.name] }),
  index("instance_skills_instance_idx").on(table.instanceId),
]);

export const instanceSkillPublishes = pgTable("instance_skill_publishes", {
  id: text("id").primaryKey(),
  instanceId: text("instance_id").notNull(),
  skillName: text("skill_name").notNull(),
  sourceId: text("source_id").notNull(),
  sourceName: text("source_name").notNull(),
  sourceGitUrl: text("source_git_url").notNull(),
  prUrl: text("pr_url").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("instance_skill_publishes_instance_idx").on(table.instanceId),
]);
