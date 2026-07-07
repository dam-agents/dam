import { z } from "zod";

export const contributionKind = z.enum([
  "env",
  "egress-allow",
  "egress-inject",
  "file",
  "mcp-entry",
  "skill-ref",
]);
export type ContributionKind = z.infer<typeof contributionKind>;

export const eventKind = z.enum([
  "trigger",
  "schedule-reset",
  "workspace-seed",
  "experiment-trigger",
  "harness-config",
]);
export type EventKind = z.infer<typeof eventKind>;

export const mergeMode = z.enum([
  "overwrite",
  "section-marker",
  "key-targeted",
  "yaml-fill-if-missing",
]);
export type MergeMode = z.infer<typeof mergeMode>;

export const fileFormat = z.enum(["yaml", "json", "text", "ini", "toml"]);
export type FileFormat = z.infer<typeof fileFormat>;

export const envContribution = z.object({
  kind: z.literal("env"),
  name: z.string().min(1),
  placeholder: z.string(),
});

// Upstream port; omit for 443. Only L7 chains honor it — the L4 catch-all
// always dials 443 (a CONNECT's authority port is lost at the tunnel handoff).
const egressPort = z.number().int().min(1).max(65535).optional();

export const egressAllowContribution = z.object({
  kind: z.literal("egress-allow"),
  host: z.string().min(1),
  port: egressPort,
  pathPattern: z.string().optional(),
});

export const egressInjectContribution = z.object({
  kind: z.literal("egress-inject"),
  host: z.string().min(1),
  pathPattern: z.string().optional(),
  headerName: z.string().min(1),
  valueFormat: z.string().min(1),
  encoding: z.literal("basic-x-access-token").optional(),
  // Moves the value into this query param instead of the header; restricted to unreserved chars since the Lua treats it as a trusted literal.
  queryParamName: z
    .string()
    .regex(/^[A-Za-z0-9_.~-]+$/)
    .optional(),
  // Terminate this host's gateway chain as HTTP/2 so injection lands on a gRPC
  // stream (e.g. Modal's x-modal-token-* metadata). Flows to the injection-hosts
  // annotation the controller reads. Omit for HTTP/1.1 REST hosts.
  http2: z.boolean().optional(),
  port: egressPort,
  // Tunnel WebSocket/SPDY upgrades (kubectl streaming); keeps the chain h1.
  upgrades: z.boolean().optional(),
  // Validate the upstream against the CA in the connection Secret, not the
  // system store (self-signed cluster CAs).
  upstreamCa: z.boolean().optional(),
});

export const fileContribution = z.object({
  kind: z.literal("file"),
  path: z.string().min(1),
  format: fileFormat,
  mergeMode: mergeMode,
  content: z.unknown().optional(),
});

export const mcpEntryContribution = z.object({
  kind: z.literal("mcp-entry"),
  name: z.string().min(1),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const skillRefContribution = z.object({
  kind: z.literal("skill-ref"),
  sourceUrl: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  path: z.string().optional(),
});

export const contribution = z.discriminatedUnion("kind", [
  envContribution,
  egressAllowContribution,
  egressInjectContribution,
  fileContribution,
  mcpEntryContribution,
  skillRefContribution,
]);
export type Contribution = z.infer<typeof contribution>;

export const triggerEventPayload = z.object({
  scheduleId: z.string().min(1),
  task: z.string().min(1),
  sessionMode: z.enum(["continuous", "fresh"]).optional(),
  mcpServers: z.array(z.unknown()).optional(),
});
export type TriggerEventPayload = z.infer<typeof triggerEventPayload>;

export const triggerEvent = z.object({
  id: z.string().min(1),
  kind: z.literal("trigger"),
  version: z.number().int().nonnegative(),
  expiresAt: z.string().datetime({ offset: true }),
  payload: triggerEventPayload,
});

export const scheduleResetEventPayload = z.object({
  scheduleId: z.string().min(1),
});
export type ScheduleResetEventPayload = z.infer<
  typeof scheduleResetEventPayload
>;

export const scheduleResetEvent = z.object({
  id: z.string().min(1),
  kind: z.literal("schedule-reset"),
  version: z.number().int().nonnegative(),
  expiresAt: z.string().datetime({ offset: true }),
  payload: scheduleResetEventPayload,
});

// One-shot seed of the agent's working directory from a public git repo:
// fire once at create, clone, forget. Not reconciled state — the clone is the
// user's mutable workspace, which the platform never re-asserts or removes.
export const workspaceSeedEventPayload = z.object({
  url: z.string().min(1),
  /** Branch or tag to clone; omitted = the repo's default branch. */
  ref: z.string().min(1).optional(),
});
export type WorkspaceSeedEventPayload = z.infer<
  typeof workspaceSeedEventPayload
>;

export const workspaceSeedEvent = z.object({
  id: z.string().min(1),
  kind: z.literal("workspace-seed"),
  version: z.number().int().nonnegative(),
  expiresAt: z.string().datetime({ offset: true }),
  payload: workspaceSeedEventPayload,
});

export const experimentTriggerEventPayload = z.object({
  experimentId: z.string().min(1),
  task: z.string().min(1),
});
export type ExperimentTriggerEventPayload = z.infer<
  typeof experimentTriggerEventPayload
>;

export const experimentTriggerEvent = z.object({
  id: z.string().min(1),
  kind: z.literal("experiment-trigger"),
  version: z.number().int().nonnegative(),
  expiresAt: z.string().datetime({ offset: true }),
  payload: experimentTriggerEventPayload,
});

// One-shot apply of a per-agent harness config change (model / mode / config
// options) into the harness's own config file. Like workspace-seed: fire once on
// a user action, apply, forget — never re-asserted, so the file stays the user's
// to edit. `unset` lists logical fields to remove (a "Not set" / clear in the
// UI). The agent's manifest owns the field → file/keyPath mapping.
export const harnessConfigEventPayload = z.object({
  model: z.string().min(1).optional(),
  mode: z.string().min(1).optional(),
  configOptions: z.record(z.string().min(1), z.string()).optional(),
  unset: z.array(z.string().min(1)).optional(),
});
export type HarnessConfigEventPayload = z.infer<
  typeof harnessConfigEventPayload
>;

export const harnessConfigEvent = z.object({
  id: z.string().min(1),
  kind: z.literal("harness-config"),
  version: z.number().int().nonnegative(),
  expiresAt: z.string().datetime({ offset: true }),
  payload: harnessConfigEventPayload,
});

export const event = z.discriminatedUnion("kind", [
  triggerEvent,
  scheduleResetEvent,
  workspaceSeedEvent,
  experimentTriggerEvent,
  harnessConfigEvent,
]);
export type Event = z.infer<typeof event>;

// The config catalog a harness offers (model/mode/effort/…), declared in its
// manifest. Mirrors the ACP select-option shape so the UI renders it unchanged.
export const harnessConfigChoice = z.object({
  value: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});
export type HarnessConfigChoice = z.infer<typeof harnessConfigChoice>;

export const harnessConfigOptionGroup = z.object({
  // "model", "mode", or a configOption id (e.g. "effort").
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  // ACP-style category: "model" | "mode" | "thought_level" | …
  category: z.string().min(1),
  choices: z.array(harnessConfigChoice),
});
export type HarnessConfigOptionGroup = z.infer<typeof harnessConfigOptionGroup>;

export const harnessConfigCatalog = z.object({
  options: z.array(harnessConfigOptionGroup),
  // Per-model validity: allowed choice values per gated group. Model absent =
  // all allowed; empty array = group hidden for that model (e.g. Haiku effort).
  modelConstraints: z
    .record(z.string().min(1), z.record(z.string().min(1), z.array(z.string())))
    .optional(),
});
export type HarnessConfigCatalog = z.infer<typeof harnessConfigCatalog>;

export const capabilities = z.object({
  contributions: z.array(contributionKind),
  events: z.array(eventKind),
  // Whether the harness declares a config mapping (gates the UI panel). Optional
  // for forward-compat with agents that predate it.
  harnessConfig: z.boolean().optional(),
  // The option catalog from the harness's manifest (absent → UI hides the panel).
  harnessConfigCatalog: harnessConfigCatalog.optional(),
});
export type Capabilities = z.infer<typeof capabilities>;

export const stateSlice = z.object({
  contributions: z.array(contribution),
  hash: z.string().min(1),
});
export type StateSlice = z.infer<typeof stateSlice>;

export const applyStateInput = z.object({
  version: z.number().int().positive(),
  state: stateSlice,
  events: z.array(event),
});
export type ApplyStateInput = z.infer<typeof applyStateInput>;

export const driverFailure = z.object({
  kind: contributionKind,
  message: z.string().min(1),
});
export type DriverFailure = z.infer<typeof driverFailure>;

// Discriminated outcome so the worker dispatches on `status`, never on error strings.
export const applyStateResult = z.discriminatedUnion("status", [
  // Processed: resulting cursor + any per-driver failures (empty on a fully clean apply).
  z.object({
    status: z.literal("ok"),
    appliedVersion: z.number().int().nonnegative(),
    appliedHash: z.string().min(1).nullable(), // null until the first clean settle
    failures: z.array(driverFailure).default([]),
    settledEvents: z.array(z.string()).default([]),
  }),
  // Contributions already at ≥ the requested version; worker reconciles. Events still apply (own version) — settledEvents reports which.
  z.object({
    status: z.literal("stale"),
    appliedVersion: z.number().int().nonnegative(),
    settledEvents: z.array(z.string()).default([]),
  }),
]);
export type ApplyStateResult = z.infer<typeof applyStateResult>;

export const helloInput = z.object({
  lastAppliedVersion: z.number().int().nonnegative().optional(),
  lastAppliedHash: z.string().optional(),
  protocolVersion: z.literal("v1"),
  agentRuntimeVersion: z.string(),
  capabilities,
});
export type HelloInput = z.infer<typeof helloInput>;

export const helloResult = z.object({
  version: z.number().int().positive().optional(),
  state: stateSlice.optional(),
  events: z.array(event),
});
export type HelloResult = z.infer<typeof helloResult>;
