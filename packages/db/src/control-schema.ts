import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const control = pgSchema("control");

const patterns = {
  quantity: String.raw`^(\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))(([KMGTPE]i)|[numkMGTPE]|([eE](\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))))?$`,
  dnsLabel: String.raw`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`,
  l7Host: String.raw`^(\*\.)?([a-zA-Z0-9]([-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?)*$`,
  conditionReason: String.raw`^[A-Za-z]([A-Za-z0-9_,:]*[A-Za-z0-9_])?$`,
  commit: String.raw`^[0-9a-f]{40}$`,
};

const pattern = (name: keyof typeof patterns) => sql.raw(`'${patterns[name]}'`);

export const controlAgents = control.table(
  "agents",
  {
    id: text("id").primaryKey(),
    incarnation: uuid("incarnation").notNull().defaultRandom(),
    ownerSub: text("owner_sub").notNull(),
    templateId: text("template_id"),
    environmentOf: text("environment_of"),
    name: text("name").notNull().default(""),
    description: text("description"),
    avatar: text("avatar"),
    whispersOff: boolean("whispers_off").notNull().default(false),
    image: text("image").notNull(),
    harness: text("harness"),
    imagePullSecretRef: text("image_pull_secret_ref"),
    secretRef: text("secret_ref"),
    hibernationTimeoutNs: bigint("hibernation_timeout_ns", { mode: "number" }),
    nestedVirtualization: boolean("nested_virtualization")
      .notNull()
      .default(false),
    requireConnectionAddress: boolean("require_connection_address")
      .notNull()
      .default(false),
    telemetryAttributionId: text("telemetry_attribution_id"),
    cpuLimit: text("cpu_limit").notNull(),
    memoryLimit: text("memory_limit").notNull(),
    diskSize: text("disk_size"),
    memoryFallbackBytes: bigint("memory_fallback_bytes", { mode: "number" }),
    diskFloorBytes: bigint("disk_floor_bytes", { mode: "number" }),
    unsupportedPersistentPaths: text("unsupported_persistent_paths")
      .array()
      .notNull()
      .default([]),
    sweepable: boolean("sweepable").notNull().default(false),
    lifetimeMs: bigint("lifetime_ms", { mode: "number" }),
    kind: text("kind"),
    kbTemplateId: text("kb_template_id"),
    kbShareRoots: text("kb_share_roots").array(),
    imageUpdateFrom: text("image_update_from"),
    imageUpdateRefused: text("image_update_refused"),
    generation: bigint("generation", { mode: "number" }).notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "control_agents_id_dns_label",
      sql`${table.id} ~ ${pattern("dnsLabel")} AND length(${table.id}) <= 63`,
    ),
    check(
      "control_agents_owner_sub_present",
      sql`length(${table.ownerSub}) > 0`,
    ),
    check("control_agents_image_present", sql`length(${table.image}) > 0`),
    check(
      "control_agents_cpu_limit_quantity",
      sql`${table.cpuLimit} ~ ${pattern("quantity")}`,
    ),
    check(
      "control_agents_memory_limit_quantity",
      sql`${table.memoryLimit} ~ ${pattern("quantity")}`,
    ),
    check(
      "control_agents_disk_size_quantity",
      sql`${table.diskSize} IS NULL OR ${table.diskSize} ~ ${pattern("quantity")}`,
    ),
    check(
      "control_agents_hibernation_timeout_ns",
      sql`${table.hibernationTimeoutNs} IS NULL OR ${table.hibernationTimeoutNs} >= 0`,
    ),
    check(
      "control_agents_lifetime_ms",
      sql`${table.lifetimeMs} IS NULL OR ${table.lifetimeMs} >= 0`,
    ),
    check(
      "control_agents_memory_fallback_bytes",
      sql`${table.memoryFallbackBytes} IS NULL OR ${table.memoryFallbackBytes} > 0`,
    ),
    check(
      "control_agents_disk_floor_bytes",
      sql`${table.diskFloorBytes} IS NULL OR ${table.diskFloorBytes} > 0`,
    ),
    check("control_agents_generation_positive", sql`${table.generation} > 0`),
    uniqueIndex("control_agents_incarnation_idx").on(table.incarnation),
    index("control_agents_owner_idx").on(
      table.ownerSub,
      table.createdAt,
      table.id,
    ),
    index("control_agents_environment_of_idx")
      .on(table.environmentOf)
      .where(sql`${table.environmentOf} IS NOT NULL`),
    index("control_agents_updated_at_idx").on(table.updatedAt),
  ],
);

export const controlAgentSignals = control.table(
  "agent_signals",
  {
    agentId: text("agent_id")
      .primaryKey()
      .references(() => controlAgents.id, { onDelete: "cascade" }),
    version: bigint("version", { mode: "number" }).notNull().default(0),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    lastActivityToken: uuid("last_activity_token"),
    sessionPinned: boolean("session_pinned").notNull().default(false),
    invocationPinned: boolean("invocation_pinned").notNull().default(false),
    invocationPinVersion: bigint("invocation_pin_version", { mode: "number" })
      .notNull()
      .default(0),
    stopRequestToken: text("stop_request_token"),
    stopRequestedAt: timestamp("stop_requested_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    rollRev: text("roll_rev").notNull().default(""),
    reclaimedAt: timestamp("reclaimed_at", { withTimezone: true }),
    reclaimedActivityToken: uuid("reclaimed_activity_token"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("control_agent_signals_session_pinned_idx")
      .on(table.agentId)
      .where(sql`${table.sessionPinned}`),
    index("control_agent_signals_invocation_pinned_idx")
      .on(table.agentId)
      .where(sql`${table.invocationPinned}`),
    index("control_agent_signals_disabled_idx")
      .on(table.agentId)
      .where(sql`${table.disabledAt} IS NOT NULL`),
  ],
);

export const controlAgentStatus = control.table("agent_status", {
  agentId: text("agent_id")
    .primaryKey()
    .references(() => controlAgents.id, { onDelete: "cascade" }),
  observedGeneration: bigint("observed_generation", { mode: "number" })
    .notNull()
    .default(0),
  observedSignalVersion: bigint("observed_signal_version", { mode: "number" })
    .notNull()
    .default(0),
  machineRestarts: integer("machine_restarts").notNull().default(0),
  machineRestartReason: text("machine_restart_reason"),
  machineUpAt: timestamp("machine_up_at", { withTimezone: true }),
  machineDownAt: timestamp("machine_down_at", { withTimezone: true }),
  memoryWaitUntil: timestamp("memory_wait_until", { withTimezone: true }),
  runnerOomKillId: text("runner_oom_kill_id"),
  runnerOomRecoveredId: text("runner_oom_recovered_id"),
  version: bigint("version", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const controlAgentConditions = control.table(
  "agent_conditions",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => controlAgents.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    status: text("status").notNull(),
    reason: text("reason").notNull(),
    message: text("message").notNull().default(""),
    observedGeneration: bigint("observed_generation", {
      mode: "number",
    }).notNull(),
    lastTransitionAt: timestamp("last_transition_at", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.type] }),
    check(
      "control_agent_conditions_status",
      sql`${table.status} IN ('True', 'False', 'Unknown')`,
    ),
    check(
      "control_agent_conditions_reason",
      sql`${table.reason} ~ ${pattern("conditionReason")} AND length(${table.reason}) <= 1024`,
    ),
    check(
      "control_agent_conditions_message",
      sql`length(${table.message}) <= 32768`,
    ),
  ],
);

export const controlAgentL7Hosts = control.table(
  "agent_l7_hosts",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => controlAgents.id, { onDelete: "cascade" }),
    host: text("host").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.host] }),
    check(
      "control_agent_l7_hosts_host",
      sql`${table.host} ~ ${pattern("l7Host")} AND length(${table.host}) <= 253`,
    ),
  ],
);

export const controlAgentKitState = control.table(
  "agent_kit_state",
  {
    agentId: text("agent_id")
      .primaryKey()
      .references(() => controlAgents.id, { onDelete: "cascade" }),
    version: bigint("version", { mode: "number" }).notNull().default(0),
    starterKit: text("starter_kit"),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    seedUrl: text("seed_url"),
    seedBranch: text("seed_branch"),
    seedCommit: text("seed_commit"),
    defaultModel: text("default_model"),
    pendingCommit: text("pending_commit"),
    pendingStartedAt: timestamp("pending_started_at", { withTimezone: true }),
    skippedCommit: text("skipped_commit"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "control_agent_kit_state_seed_commit",
      sql`${table.seedCommit} IS NULL OR ${table.seedCommit} ~ ${pattern("commit")}`,
    ),
    check(
      "control_agent_kit_state_pending_commit",
      sql`${table.pendingCommit} IS NULL OR ${table.pendingCommit} ~ ${pattern("commit")}`,
    ),
    check(
      "control_agent_kit_state_skipped_commit",
      sql`${table.skippedCommit} IS NULL OR ${table.skippedCommit} ~ ${pattern("commit")}`,
    ),
    check(
      "control_agent_kit_state_seed_pair",
      sql`(${table.seedUrl} IS NULL) = (${table.seedCommit} IS NULL)`,
    ),
    check(
      "control_agent_kit_state_pending_pair",
      sql`(${table.pendingCommit} IS NULL) = (${table.pendingStartedAt} IS NULL)`,
    ),
  ],
);

export const controlUserBudgets = control.table(
  "user_budgets",
  {
    ownerSub: text("owner_sub").primaryKey(),
    cpu: text("cpu"),
    memory: text("memory"),
    storage: text("storage"),
    setBySub: text("set_by_sub"),
    operatorUpdatedAt: timestamp("operator_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "control_user_budgets_owner_sub",
      sql`length(${table.ownerSub}) BETWEEN 1 AND 246`,
    ),
    check(
      "control_user_budgets_cpu_quantity",
      sql`${table.cpu} IS NULL OR ${table.cpu} ~ ${pattern("quantity")}`,
    ),
    check(
      "control_user_budgets_memory_quantity",
      sql`${table.memory} IS NULL OR ${table.memory} ~ ${pattern("quantity")}`,
    ),
    check(
      "control_user_budgets_storage_quantity",
      sql`${table.storage} IS NULL OR ${table.storage} ~ ${pattern("quantity")}`,
    ),
    check(
      "control_user_budgets_has_override",
      sql`num_nonnulls(${table.cpu}, ${table.memory}, ${table.storage}) >= 1`,
    ),
    index("control_user_budgets_updated_at_idx").on(
      table.updatedAt,
      table.ownerSub,
    ),
  ],
);

export const controlAgentStore = control.table(
  "agent_store",
  {
    id: smallint("id").primaryKey().default(1),
    schemaGeneration: integer("schema_generation").notNull().default(1),
    absorbedAt: timestamp("absorbed_at", { withTimezone: true }),
    anchorsEnsuredAt: timestamp("anchors_ensured_at", { withTimezone: true }),
    switchCompletedAt: timestamp("switch_completed_at", {
      withTimezone: true,
    }),
    controllerHolder: text("controller_holder"),
    backupRef: text("backup_ref"),
    absorbReport: jsonb("absorb_report"),
  },
  (table) => [check("control_agent_store_single_row", sql`${table.id} = 1`)],
);

export const controlCrdSnapshots = control.table(
  "crd_snapshots",
  {
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    uid: uuid("uid"),
    sha256: text("sha256").notNull(),
    yaml: text("yaml").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.capturedAt, table.kind, table.name] }),
  ],
);
