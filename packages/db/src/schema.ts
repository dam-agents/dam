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
  doublePrecision,
} from "drizzle-orm/pg-core";

/** Outcome of a recorded activity. Constrained at the DB so a typo or a
 *  forgotten field surfaces as a constraint violation, not as a row that
 *  silently miscounts in the usage views. */
export const activityOutcomeEnum = pgEnum("activity_outcome", [
  "success",
  "failure",
]);

// An agent may hold several Slack bindings at once (#3086) — one row per bound
// conversation — so (agent_id, type) is a lookup index, not a uniqueness
// constraint. The place-scoped invariant that survives is the other way round:
// a Slack conversation binds to at most one agent install-wide.
export const channels = pgTable(
  "channels",
  {
    agentId: text("agent_id").notNull(),
    owner: text("owner").notNull(),
    type: text("type").notNull(),
    config: jsonb("config").notNull(),
  },
  (table) => [
    index("channels_agent_type_idx").on(table.agentId, table.type),
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

export const telegramConversations = pgTable(
  "telegram_conversations",
  {
    // SDK-encoded thread id (chat id + optional forum-topic id). Primary key
    // alone enforces the place-scoped invariant: one conversation binds to
    // exactly one Agent.
    conversationId: text("conversation_id").primaryKey(),
    agentId: text("agent_id").notNull(),
    // Keycloak sub of the Agent owner who bound the conversation — the party
    // whose Terms-of-Use acceptance gates inbound turns.
    authorizedBy: text("authorized_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("telegram_conversations_agent_idx").on(table.agentId)],
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
    // Upstream port; NULL = 443. Transparency only, outside the lookup key.
    port: integer("port"),
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
    // text, not a pg enum: the value set is GitHub's, so widening it should not
    // need a migration. The contract's Zod enum is what validates it.
    prState: text("pr_state"),
    /** Last resolution *attempt*, not last success — it doubles as the backoff
     *  clock that keeps unresolvable records off the anonymous rate limit. */
    prStateCheckedAt: timestamp("pr_state_checked_at", { withTimezone: true }),
    prEtag: text("pr_etag"),
    /** Consecutive failed attempts — the backoff multiplier and, past a
     *  bound, the retirement gate. Deferred attempts (no warm pod) don't
     *  count; reset whenever an attempt learns anything. */
    prStateCheckFailures: integer("pr_state_check_failures")
      .notNull()
      .default(0),
    /** Set once the anonymous read has 404'd; later attempts go straight to
     *  a publishing agent's pod. Never unset. */
    prNeedsPod: boolean("pr_needs_pod").notNull().default(false),
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

// Experiments v2 (#2942): an Experiment is one execution of a driver Agent's
// loop script, observed via a declared Skeleton plus a Trace of stage-tagged
// spans. The platform never runs the loop — this is the observation record.
// Script source lives in the Artifact Library (versioned), never here; the row
// keeps only the artifact reference and the sha of the last-executed source.
// `last_activity_at` is the liveness clock the inactivity sweep reads (bumped
// on every accepted trace event); the partial indexes back the sweep scan and
// the pin/agent-card "running experiments for driver" lookups.
export const experiments = pgTable(
  "experiments",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    driverAgentId: text("driver_agent_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    skeleton: jsonb("skeleton").notNull(),
    // Stages discovered from spans that the skeleton never declared.
    drift: jsonb("drift")
      .notNull()
      .default(sql`'[]'::jsonb`),
    scriptPath: text("script_path").notNull(),
    scriptSha256: text("script_sha256").notNull(),
    scriptArtifactId: text("script_artifact_id").notNull(),
    scriptVersion: integer("script_version").notNull(),
    dashboardArtifactId: text("dashboard_artifact_id"),
    // Run-level custom data the script posts (exp.post_data); opaque,
    // size-capped at ingestion, delivered to dashboards as feed.custom.
    customData: jsonb("custom_data"),
    // Artifact Library ids attached to this run outside the span flow: the
    // driver's monitoring harness (create_artifact experiment_id=) and
    // auto-attributed publishes by the run's invocation targets. The feed
    // unions these with the span-referenced rollup.
    attachedArtifactIds: jsonb("attached_artifact_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  },
  (table) => [
    index("experiments_owner_idx").on(table.owner),
    // One draft per (driver, name): plan re-registration updates the draft
    // in place; a new plan after execution creates a sibling Experiment.
    uniqueIndex("experiments_driver_name_draft_idx")
      .on(table.driverAgentId, table.name)
      .where(sql`${table.status} = 'draft'`),
    index("experiments_running_activity_idx")
      .on(table.lastActivityAt)
      .where(sql`${table.status} = 'running'`),
    index("experiments_running_driver_idx")
      .on(table.driverAgentId)
      .where(sql`${table.status} = 'running'`),
  ],
);

// One span = one execution of a skeleton stage. Upserted: span-start inserts
// the running row, span-end fills status/score/artifacts/attrs/ended_at. The
// PK embeds the experiment so the SDK-chosen span_id only has to be unique
// within its own experiment.
export const experimentSpans = pgTable(
  "experiment_spans",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    spanId: text("span_id").notNull(),
    stage: text("stage").notNull(),
    iteration: integer("iteration"),
    parentSpanId: text("parent_span_id"),
    status: text("status").notNull().default("running"),
    score: doublePrecision("score"),
    artifactIds: jsonb("artifact_ids"),
    attrs: jsonb("attrs"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("experiment_spans_experiment_started_idx").on(
      table.experimentId,
      table.startedAt,
    ),
    index("experiment_spans_experiment_stage_idx").on(
      table.experimentId,
      table.stage,
    ),
  ],
);

// Per-user feature flags (hidden Features menu). Only explicitly toggled
// features have rows — every feature defaults OFF, so absence = disabled.
// Stored server-side (not localStorage) because feature surfaces include the
// per-agent MCP tools, which only the server can hide.
export const userFeatures = pgTable(
  "user_features",
  {
    owner: text("owner").notNull(),
    feature: text("feature").notNull(),
    enabled: boolean("enabled").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.owner, table.feature] })],
);

// Artifact library (#2810): user- and agent-published artifacts, organized in
// folders, shared by public slug on the dedicated share host. The unguessable
// slug is the entire access control — no passwords by design. The current
// version's content lives in the object store at `storage_ref`; prior
// versions are rows in `library_artifact_versions`. Intra-module rows carry
// real FKs for integrity (versions cascade with their artifact; folder
// deletion ungroups via SET NULL); only references that leave Postgres
// (owner → Keycloak, agent → K8s) stay plain strings.
export const artifactFolders = pgTable(
  "artifact_folders",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("artifact_folders_owner_idx").on(table.owner),
    uniqueIndex("artifact_folders_slug_unique_idx").on(table.slug),
    uniqueIndex("artifact_folders_owner_name_unique_idx").on(
      table.owner,
      table.name,
    ),
  ],
);

// `agent_id` is attribution only (which agent published it) — artifacts
// deliberately outlive their creating agent, so it is a plain string, never a
// reference that cascades. `visibility` lifecycle: private (default, in-app
// only) → public (share link live).
export const libraryArtifacts = pgTable(
  "library_artifacts",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    agentId: text("agent_id"),
    folderId: text("folder_id").references(() => artifactFolders.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind").notNull(),
    contentType: text("content_type").notNull(),
    fileName: text("file_name").notNull(),
    storageRef: text("storage_ref").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    version: integer("version").notNull().default(1),
    visibility: text("visibility").notNull().default("private"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("library_artifacts_owner_idx").on(table.owner),
    uniqueIndex("library_artifacts_slug_unique_idx").on(table.slug),
    index("library_artifacts_folder_idx").on(table.folderId),
    index("library_artifacts_agent_idx").on(table.agentId),
    // The expiry sweeper scans only rows that can still expire.
    index("library_artifacts_expires_idx")
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} is not null`),
  ],
);

// Prior versions only — the current version lives on `library_artifacts`
// itself, so the hot read path (viewer resolve-by-slug) needs no join.
export const libraryArtifactVersions = pgTable(
  "library_artifact_versions",
  {
    artifactId: text("artifact_id")
      .notNull()
      .references(() => libraryArtifacts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    storageRef: text("storage_ref").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.artifactId, table.version] })],
);

// An Invocation (#2816) is a run-once, typed request from a driver Agent to a
// target Agent: a `(driver, target, prompt, result schema) -> one validated
// result` binding. The target reports via the fixed `report_result` MCP tool.
// This is the platform-owned durable record of that request — the row both
// stashes the result JSON Schema (so `report_result` can validate the target's
// structural claim) and marks the target as an Invocation (a regular agent
// calling `report_result` has no row). Lifecycle (autosweep) is NOT modeled
// here — it lives on the Agent (Sweepable / Agent Lifetime / Agent Sweep); this
// table owns only the result contract plus the per-result liveness deadline.
// The common case pairs an Invocation with a freshly-spawned ephemeral Agent,
// but that pairing is not part of the record. The candidate itself never lives
// here — it crosses round boundaries as a git ref; only the opaque `result`
// does.
export const invocations = pgTable(
  "invocations",
  {
    // Primary key is the target Agent's id — `report_result` runs on that
    // agent's own /api/agents/<id>/mcp, so the id is the attribution key.
    id: text("id").primaryKey(),
    driverAgentId: text("driver_agent_id").notNull(),
    owner: text("owner").notNull(),
    // JSON Schema the result is validated against (structural only).
    resultSchema: jsonb("result_schema").notNull(),
    // The validated result; null until the target reports.
    result: jsonb("result"),
    status: text("status").notNull().default("running"),
    errorReason: text("error_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Liveness deadline: a `running` Invocation past this is failed by the
    // liveness sweep (bounds one result, not the target agent).
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Experiments v2 span attach (#2942): "<experimentId>/<spanId>" stamped by
    // the SDK when the spawn happened inside a span, so the Trace Feed can
    // show the invocation under its stage. Null for non-experiment spawns.
    experimentSpanId: text("experiment_span_id"),
  },
  (table) => [
    index("invocations_driver_idx").on(table.driverAgentId),
    index("invocations_status_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'running'`),
    index("invocations_experiment_span_idx")
      .on(table.experimentSpanId)
      .where(sql`${table.experimentSpanId} IS NOT NULL`),
  ],
);
