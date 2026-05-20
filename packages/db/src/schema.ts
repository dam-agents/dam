import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";

export const sessionModeEnum = pgEnum("session_mode", ["chat", "terminal"]);

/** Outcome of a recorded activity. Constrained at the DB so a typo or a
 *  forgotten field surfaces as a constraint violation, not as a row that
 *  silently miscounts in the usage views. */
export const activityOutcomeEnum = pgEnum("activity_outcome", [
  "success",
  "failure",
]);

export const channels = pgTable(
  "channels",
  {
    agentId: text("agent_id").notNull(),
    owner: text("owner").notNull(),
    type: text("type").notNull(),
    config: jsonb("config").notNull(),
  },
  (table) => [
    uniqueIndex("channels_agent_type_idx").on(table.agentId, table.type),
    uniqueIndex("channels_slack_channel_unique_idx")
      .on(sql`(${table.config}->>'slackChannelId')`)
      .where(sql`${table.type} = 'slack'`),
  ],
);

export const identityLinks = pgTable(
  "identity_links",
  {
    provider: text("provider").notNull(),
    externalUserId: text("external_user_id").notNull(),
    keycloakSub: text("keycloak_sub").notNull(),
    refreshToken: text("refresh_token"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.externalUserId] })],
);

export const allowedUsers = pgTable(
  "allowed_users",
  {
    agentId: text("agent_id").notNull(),
    owner: text("owner").notNull(),
    keycloakSub: text("keycloak_sub").notNull(),
  },
  (table) => [primaryKey({ columns: [table.agentId, table.keycloakSub] })],
);

export const telegramThreads = pgTable(
  "telegram_threads",
  {
    agentId: text("agent_id").notNull(),
    threadId: text("thread_id").notNull(),
    authorizedBy: text("authorized_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.agentId, table.threadId] })],
);

/**
 * Egress rules — per-agent, owner-scoped via the agent CM. A rule keyed on
 * (agent_id, host, method, path_pattern) applies to the agent's pod and
 * any forks it spawns (mirrors the scoping of connector envs and
 * Secret-volume mounts; see ADR-024 / ADR-033 / ADR-046).
 *
 * `source` records the row's origin — `manual`, `inbox`, `connection:<id>`,
 * `preset:trusted`, `preset:all`. User edits flip the source to `manual` so
 * later connection revokes/preset reseeds don't touch the row. See
 * ADR-035 §"Single rules table, mirroring the env-injection
 * pattern".
 */
export const egressRules = pgTable(
  "egress_rules",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    host: text("host").notNull(),
    method: text("method").notNull(),
    pathPattern: text("path_pattern").notNull(),
    verdict: text("verdict").notNull(),
    decidedBy: text("decided_by").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    status: text("status").notNull().default("active"),
    source: text("source").notNull().default("manual"),
  },
  (table) => [
    uniqueIndex("egress_rules_lookup_idx")
      .on(table.agentId, table.host, table.method, table.pathPattern)
      .where(sql`${table.status} = 'active'`),
    index("egress_rules_source_idx")
      .on(table.source)
      .where(sql`${table.status} = 'active' AND ${table.source} != 'manual'`),
  ],
);

/**
 * Durable record of every HITL approval the user owes a verdict on. Written
 * before any synth-frame fan-out so the inbox sees it from t=0; survives held-
 * call timeouts, replica restarts, and pod hibernation. Held ext_authz calls
 * wake from a Redis pub/sub on `approval:<id>`; this table is the truth path.
 */
export const pendingApprovals = pgTable(
  "pending_approvals",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    agentId: text("agent_id").notNull(),
    ownerSub: text("owner_sub").notNull(),
    sessionId: text("session_id"),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    verdict: text("verdict"),
    decidedBy: text("decided_by"),
    status: text("status").notNull().default("pending"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    index("pending_approvals_owner_status_idx").on(
      table.ownerSub,
      table.status,
    ),
    index("pending_approvals_agent_status_idx").on(table.agentId, table.status),
    index("pending_approvals_undelivered_idx")
      .on(table.resolvedAt)
      .where(sql`status = 'resolved' AND delivered_at IS NULL`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionId: text("session_id").primaryKey(),
    agentId: text("agent_id").notNull(),
    type: text("type").notNull().default("regular"),
    mode: sessionModeEnum("mode").notNull(),
    scheduleId: text("schedule_id"),
    scheduleActive: boolean("schedule_active").default(true).notNull(),
    threadTs: text("thread_ts"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("sessions_agent_thread_idx")
      .on(table.agentId, table.threadTs)
      .where(sql`${table.threadTs} IS NOT NULL`),
  ],
);

export const skillSources = pgTable(
  "skill_sources",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    gitUrl: text("git_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("skill_sources_owner_git_url_idx").on(
      table.owner,
      table.gitUrl,
    ),
    index("skill_sources_owner_idx").on(table.owner),
  ],
);

export const agentSkills = pgTable(
  "agent_skills",
  {
    agentId: text("agent_id").notNull(),
    source: text("source").notNull(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    contentHash: text("content_hash"),
    installedAt: timestamp("installed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.source, table.name] }),
    index("agent_skills_agent_idx").on(table.agentId),
  ],
);

/** Append-only log of semantically-meaningful platform activity (auth, channel turns).
 *  `actor_sub` is HMAC-SHA256(keycloak_sub, ACTIVITY_HMAC_KEY) — pseudonymized
 *  (not anonymized) at the storage boundary; same key joins to actor_roles and
 *  agents.owner_sub. See packages/api-server/src/core/sub-pseudonymizer.ts. */
export const activityEvents = pgTable(
  "activity_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    actorSub: text("actor_sub"),
    agentId: text("agent_id"),
    surface: text("surface"),
    outcome: activityOutcomeEnum("outcome").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("activity_events_type_occurred_idx").on(table.type, table.occurredAt),
    index("activity_events_actor_occurred_idx")
      .on(table.actorSub, table.occurredAt)
      .where(sql`${table.actorSub} IS NOT NULL`),
    index("activity_events_surface_occurred_idx").on(
      table.surface,
      table.occurredAt,
    ),
    uniqueIndex("activity_events_auth_dedup_idx")
      .on(
        table.actorSub,
        table.surface,
        sql`date_trunc('day', ${table.occurredAt} AT TIME ZONE 'UTC')`,
      )
      .where(sql`${table.type} = 'auth'`),
  ],
);

/** Role flags keyed by pseudonymized Keycloak sub (see activity_events.actor_sub).
 *  Populated by the persist-activity saga on every UserAuthenticated event.
 *  Read by usage_core_actor_subs to feed core-team exclusion filters. */
export const actorRoles = pgTable("actor_roles", {
  actorSub: text("actor_sub").primaryKey(),
  isCore: boolean("is_core").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Postgres mirror of K8s agent ConfigMaps (ADR-046) — kept here so SQL views
 *  and cross-table joins can resolve agent ownership without a CM round-trip.
 *  Populated by the persist-agents saga (on AgentCreated/Deleted) plus a
 *  startup bootstrap that backfills agents pre-dating the saga.
 *  `owner_sub` is HMACed with the same key as activity_events.actor_sub. */
export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    ownerSub: text("owner_sub").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("agents_owner_idx").on(table.ownerSub)],
);

export const agentSkillPublishes = pgTable(
  "agent_skill_publishes",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    skillName: text("skill_name").notNull(),
    sourceId: text("source_id").notNull(),
    sourceName: text("source_name").notNull(),
    sourceGitUrl: text("source_git_url").notNull(),
    prUrl: text("pr_url").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("agent_skill_publishes_agent_idx").on(table.agentId)],
);
