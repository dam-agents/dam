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
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("channels_agent_type_idx").on(table.agentId, table.type),
    uniqueIndex("channels_slack_agent_channel_idx")
      .on(table.agentId, sql`(${table.config}->>'slackChannelId')`)
      .where(sql`${table.type} = 'slack'`),
    uniqueIndex("channels_slack_default_agent_idx")
      .on(sql`(${table.config}->>'slackChannelId')`)
      .where(
        sql`${table.type} = 'slack' AND ${table.config}->>'default' = 'true'`,
      ),
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
    conversationId: text("conversation_id").primaryKey(),
    agentId: text("agent_id").notNull(),
    authorizedBy: text("authorized_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("telegram_conversations_agent_idx").on(table.agentId)],
);

export const egressRules = pgTable(
  "egress_rules",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    host: text("host").notNull(),
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

export const skillSources = pgTable(
  "skill_sources",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    gitUrl: text("git_url").notNull(),
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

export const skillSets = pgTable(
  "skill_sets",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    skills: jsonb("skills").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("skill_sets_owner_name_idx").on(table.owner, table.name),
    index("skill_sets_owner_idx").on(table.owner),
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
    uniqueIndex("activity_events_relay_dedup_idx")
      .on(
        table.actorSub,
        table.agentId,
        sql`(${table.payload} ->> 'relay')`,
        sql`date_trunc('day', ${table.occurredAt} AT TIME ZONE 'UTC')`,
      )
      .where(sql`${table.type} = 'relay_attached'`),
    uniqueIndex("activity_events_entry_point_dedup_idx")
      .on(table.actorSub, table.type)
      .where(sql`${table.type} = 'entry_point_chosen'`),
  ],
);

export const actorRoles = pgTable("actor_roles", {
  actorSub: text("actor_sub").primaryKey(),
  isCore: boolean("is_core").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
    harnessConfigSnapshot: jsonb("harness_config_snapshot"),
    skillsSnapshot: jsonb("skills_snapshot"),
  },
  (table) => [index("agents_owner_idx").on(table.ownerSub)],
);

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

export const agentPublicProfiles = pgTable("agent_public_profiles", {
  agentId: text("agent_id").primaryKey(),
  name: text("name").notNull(),
  ownerSub: text("owner_sub").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
    prState: text("pr_state"),
    prStateCheckedAt: timestamp("pr_state_checked_at", { withTimezone: true }),
    prEtag: text("pr_etag"),
    prStateCheckFailures: integer("pr_state_check_failures")
      .notNull()
      .default(0),
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
    lastSettledVersion: bigint("last_settled_version", { mode: "number" })
      .notNull()
      .default(0),
    lastAppliedVersion: bigint("last_applied_version", { mode: "number" })
      .notNull()
      .default(0),
    lastAppliedHash: text("last_applied_hash"),
    lastAppliedAt: timestamp("last_applied_at", { withTimezone: true }),
    applyFailures: jsonb("apply_failures")
      .notNull()
      .default(sql`'[]'::jsonb`),
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

export const experiments = pgTable(
  "experiments",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    driverAgentId: text("driver_agent_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    skeleton: jsonb("skeleton").notNull(),
    drift: jsonb("drift")
      .notNull()
      .default(sql`'[]'::jsonb`),
    scriptPath: text("script_path").notNull(),
    scriptSha256: text("script_sha256").notNull(),
    scriptArtifactId: text("script_artifact_id").notNull(),
    scriptVersion: integer("script_version").notNull(),
    dashboardArtifactId: text("dashboard_artifact_id"),
    customData: jsonb("custom_data"),
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
    interactive: boolean("interactive").notNull().default(false),
    ownSession: boolean("own_session").notNull().default(false),
    sessionId: text("session_id"),
    brief: text("brief"),
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
    index("library_artifacts_expires_idx")
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} is not null`),
  ],
);

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

export const artifactRequests = pgTable(
  "artifact_requests",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => libraryArtifacts.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    seq: integer("seq").notNull(),
    action: text("action").notNull(),
    payload: jsonb("payload").notNull(),
    trigger: text("trigger").notNull(),
    state: text("state").notNull().default("pending"),
    result: jsonb("result"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    index("artifact_requests_artifact_created_idx").on(
      table.artifactId,
      table.createdAt,
    ),
    uniqueIndex("artifact_requests_artifact_seq_unique_idx").on(
      table.artifactId,
      table.seq,
    ),
    uniqueIndex("artifact_requests_in_flight_unique_idx")
      .on(table.artifactId)
      .where(sql`${table.state} in ('pending', 'delivered')`),
  ],
);

export const invocations = pgTable(
  "invocations",
  {
    id: text("id").primaryKey(),
    driverAgentId: text("driver_agent_id").notNull(),
    owner: text("owner").notNull(),
    resultSchema: jsonb("result_schema").notNull(),
    result: jsonb("result"),
    status: text("status").notNull().default("running"),
    errorReason: text("error_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
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
