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
  "artifact-request",
  "workspace-seed",
  "workspace-command",
  "experiment-execute",
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
  queryParamName: z
    .string()
    .regex(/^[A-Za-z0-9_.~-]+$/)
    .optional(),
  http2: z.boolean().optional(),
  port: egressPort,
  upgrades: z.boolean().optional(),
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

export const artifactRequestEventPayload = z.object({
  requestId: z.string().min(1),
  artifactId: z.string().min(1),
  task: z.string().min(1),
  sessionId: z.string().min(1),
});
export type ArtifactRequestEventPayload = z.infer<
  typeof artifactRequestEventPayload
>;

export const artifactRequestEvent = z.object({
  id: z.string().min(1),
  kind: z.literal("artifact-request"),
  version: z.number().int().nonnegative(),
  expiresAt: z.string().datetime({ offset: true }),
  payload: artifactRequestEventPayload,
});

export const workspaceSeedEventPayload = z.object({
  url: z.string().min(1),
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

export const workspaceCommandEventPayload = z.object({
  command: z.string().min(1),
});
export type WorkspaceCommandEventPayload = z.infer<
  typeof workspaceCommandEventPayload
>;

export const workspaceCommandEvent = z.object({
  id: z.string().min(1),
  kind: z.literal("workspace-command"),
  version: z.number().int().nonnegative(),
  expiresAt: z.string().datetime({ offset: true }),
  payload: workspaceCommandEventPayload,
});

export const experimentExecuteEventPayload = z.object({
  experimentId: z.string().min(1),
  task: z.string().min(1),
});
export type ExperimentExecuteEventPayload = z.infer<
  typeof experimentExecuteEventPayload
>;

export const experimentExecuteEvent = z.object({
  id: z.string().min(1),
  kind: z.literal("experiment-execute"),
  version: z.number().int().nonnegative(),
  expiresAt: z.string().datetime({ offset: true }),
  payload: experimentExecuteEventPayload,
});

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
  artifactRequestEvent,
  workspaceSeedEvent,
  workspaceCommandEvent,
  experimentExecuteEvent,
  harnessConfigEvent,
]);
export type Event = z.infer<typeof event>;

export const harnessConfigChoice = z.object({
  value: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});
export type HarnessConfigChoice = z.infer<typeof harnessConfigChoice>;

export const harnessConfigOptionGroup = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().min(1),
  choices: z.array(harnessConfigChoice),
});
export type HarnessConfigOptionGroup = z.infer<typeof harnessConfigOptionGroup>;

export const harnessConfigCatalog = z.object({
  options: z.array(harnessConfigOptionGroup),
  modelConstraints: z
    .record(z.string().min(1), z.record(z.string().min(1), z.array(z.string())))
    .optional(),
});
export type HarnessConfigCatalog = z.infer<typeof harnessConfigCatalog>;

export const harnessConfigCurrent = z.object({
  model: z.string().nullable(),
  mode: z.string().nullable(),
  configOptions: z.record(z.string().min(1), z.string()),
  availableModels: z.array(harnessConfigChoice).nullable().optional(),
});
export type HarnessConfigCurrent = z.infer<typeof harnessConfigCurrent>;

export const capabilities = z.object({
  contributions: z.array(contributionKind),
  events: z.array(eventKind),
  harnessConfig: z.boolean().optional(),
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

export const applyStateResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    appliedVersion: z.number().int().nonnegative(),
    appliedHash: z.string().min(1).nullable(),
    failures: z.array(driverFailure).default([]),
    settledEvents: z.array(z.string()).default([]),
    harnessConfigCurrent: harnessConfigCurrent.optional(),
  }),
  z.object({
    status: z.literal("stale"),
    appliedVersion: z.number().int().nonnegative(),
    settledEvents: z.array(z.string()).default([]),
    harnessConfigCurrent: harnessConfigCurrent.optional(),
  }),
]);
export type ApplyStateResult = z.infer<typeof applyStateResult>;

export const helloInput = z.object({
  lastAppliedVersion: z.number().int().nonnegative().optional(),
  lastAppliedHash: z.string().optional(),
  protocolVersion: z.literal("v1"),
  agentRuntimeVersion: z.string(),
  capabilities,
  harnessConfigCurrent: harnessConfigCurrent.optional(),
});
export type HelloInput = z.infer<typeof helloInput>;

export const helloResult = z.object({
  version: z.number().int().positive().optional(),
  state: stateSlice.optional(),
  events: z.array(event),
});
export type HelloResult = z.infer<typeof helloResult>;
