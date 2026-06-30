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
  bigint,
  integer,
} from "drizzle-orm/pg-core";

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
 * Secret-volume mounts).
 *
 * `source` records the row's origin — `manual`, `inbox`, `connection:<id>`,
 * `preset:trusted`, `preset:all`. User edits flip the source to `manual` so
 * later connection revokes/preset reseeds don't touch the row. A single
 * rules table mirrors the env-injection pattern.
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

// Sessions are agent-owned: the agent's on-disk store is the source
// of truth, surfaced over ACP `_meta`. The server keeps no session table.

export const skillSources = pgTable(
  "skill_sources",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    gitUrl: text("git_url").notNull(),
    // Repo-relative subdir to scan; null ⇒ default (`skills/` then root).
    path: text("path"),
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
    // Source's `path` denormalized at install time; the source may be a
    // non-persisted system/template entry, or since deleted.
    path: text("path"),
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

/** Postgres mirror of K8s agent ConfigMaps — kept here so SQL views
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
    runtimeProtocolVersion: text("runtime_protocol_version"),
    runtimeCapabilities: jsonb("runtime_capabilities"),
    runtimeLastHelloAt: timestamp("runtime_last_hello_at", {
      withTimezone: true,
    }),
    runtimeAgentVersion: text("runtime_agent_version"),
  },
  (table) => [index("agents_owner_idx").on(table.ownerSub)],
);

/** Per-agent user-typed env (the UI Environment editor). */
export const agentEnv = pgTable(
  "agent_env",
  {
    agentId: text("agent_id").notNull(),
    name: text("name").notNull(),
    value: text("value").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.name] }),
    index("agent_env_agent_idx").on(table.agentId),
  ],
);

export const termsAcceptances = pgTable(
  "terms_acceptances",
  {
    sub: text("sub").notNull(),
    version: text("version").notNull(),
    hash: text("hash").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.sub, table.version] })],
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

export const connections = pgTable(
  "connections",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    templateId: text("template_id").notNull(),
    name: text("name").notNull(),
    inputs: jsonb("inputs").notNull(),
    auth: jsonb("auth").notNull(),
    contributions: jsonb("contributions").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("connections_owner_idx").on(table.owner),
    uniqueIndex("connections_owner_name_unique_idx").on(
      table.owner,
      table.name,
    ),
  ],
);

export const connectionGrants = pgTable(
  "connection_grants",
  {
    connectionId: text("connection_id").notNull(),
    agentId: text("agent_id").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId, table.agentId] }),
    index("connection_grants_agent_idx").on(table.agentId),
  ],
);

export const runtimeStateOutbox = pgTable(
  "runtime_state_outbox",
  {
    agentId: text("agent_id").primaryKey(),
    version: bigint("version", { mode: "number" }).notNull().default(0),
    lastEnqueuedAt: timestamp("last_enqueued_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    // Last version whose apply cycle settled (terminated), success or not — the readiness gate.
    lastSettledVersion: bigint("last_settled_version", { mode: "number" })
      .notNull()
      .default(0),
    // Last fully-clean version; advances only when every driver succeeded.
    lastAppliedVersion: bigint("last_applied_version", { mode: "number" })
      .notNull()
      .default(0),
    lastAppliedHash: text("last_applied_hash"),
    lastAppliedAt: timestamp("last_applied_at", { withTimezone: true }),
    // Drivers that failed the last settle (DriverFailure[]); drives retry + the degraded badge.
    applyFailures: jsonb("apply_failures")
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Failing-settle retry counter for the current version; capped by the sweep.
    applyAttempts: integer("apply_attempts").notNull().default(0),
  },
  (table) => [
    index("runtime_state_outbox_retry_idx")
      .on(table.applyAttempts)
      .where(
        sql`${table.applyFailures} <> '[]'::jsonb OR ${table.lastSettledVersion} < ${table.version}`,
      ),
  ],
);

export const runtimeEvents = pgTable(
  "runtime_events",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  },
  (table) => [
    index("runtime_events_agent_pending_idx")
      .on(table.agentId, table.version)
      .where(sql`${table.dispatchedAt} IS NULL`),
    index("runtime_events_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.dispatchedAt} IS NULL`),
  ],
);

export const schedules = pgTable(
  "schedules",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    spec: jsonb("spec").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    nextRun: timestamp("next_run", { withTimezone: true }),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    lastFiredResult: text("last_fired_result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("schedules_agent_owner_idx").on(table.agentId, table.owner),
    index("schedules_enabled_idx")
      .on(table.id)
      .where(sql`${table.enabled} = true`),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    ownerSub: text("owner_sub").notNull(),
    name: text("name").notNull(),
    hash: text("hash").notNull(),
    scopes: text("scopes").array().notNull(),
    agentIds: text("agent_ids").array(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("api_keys_hash_idx").on(table.hash),
    index("api_keys_owner_idx")
      .on(table.ownerSub)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);
