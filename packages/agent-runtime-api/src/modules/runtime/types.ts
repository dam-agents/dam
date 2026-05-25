import { z } from "zod";

/**
 * Wire contract for the unified runtime channel (ADR-052). Carries the agent's
 * desired-state slice (Contributions) and the pending events slice with a
 * single shared monotonic cursor. See docs/architecture/connections.md.
 *
 * The schemas here are the canonical wire shape. Both sides (api-server →
 * `applyState`, agent → `hello`) reference these.
 */

export const contributionKind = z.enum([
  "env",
  "egress-host",
  "file",
  "mcp-entry",
  "skill-ref",
]);
export type ContributionKind = z.infer<typeof contributionKind>;

export const eventKind = z.enum(["trigger"]);
export type EventKind = z.infer<typeof eventKind>;

export const mergeMode = z.enum([
  "overwrite",
  "section-marker",
  "key-targeted",
  "yaml-fill-if-missing",
]);
export type MergeMode = z.infer<typeof mergeMode>;

export const fileFormat = z.enum(["yaml", "json", "text", "ini"]);
export type FileFormat = z.infer<typeof fileFormat>;

// `egress-host` is a routing-rail Contribution — api-server consumes it for
// the egress_rules sync (Envoy ext_authz) and the agent never sees it. We
// still keep its shape on the wire so the api-server fan-out router can pass
// a unified Contribution[] through.
export const hostInjection = z.object({
  headerName: z.string().optional(),
  valueFormat: z.string().optional(),
  encoding: z.literal("basic-x-access-token").optional(),
});
export type HostInjection = z.infer<typeof hostInjection>;

export const envContribution = z.object({
  kind: z.literal("env"),
  name: z.string().min(1),
  placeholder: z.string(),
});

export const egressHostContribution = z.object({
  kind: z.literal("egress-host"),
  host: z.string().min(1),
  pathPattern: z.string().optional(),
  injection: hostInjection.optional(),
});

export const fileContribution = z.object({
  kind: z.literal("file"),
  path: z.string().min(1),
  format: fileFormat,
  mergeMode: mergeMode,
  content: z.unknown(),
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
});

export const contribution = z.discriminatedUnion("kind", [
  envContribution,
  egressHostContribution,
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

export const event = z.discriminatedUnion("kind", [triggerEvent]);
export type Event = z.infer<typeof event>;

export const capabilities = z.object({
  contributions: z.array(contributionKind),
  events: z.array(eventKind),
});
export type Capabilities = z.infer<typeof capabilities>;

export const stateSlice = z.object({
  contributions: z.array(contribution),
  // Deterministic hash over `contributions`. Lets the agent short-circuit
  // no-op pushes (`appliedHash === incomingHash` → skip reconciliation).
  hash: z.string().min(1),
});
export type StateSlice = z.infer<typeof stateSlice>;

export const applyStateInput = z.object({
  // Per-agent monotonic cursor. Bumped on any contribution edit or event
  // insert. The agent's `lastAppliedVersion` rejects older pushes.
  version: z.number().int().positive(),
  state: stateSlice,
  events: z.array(event),
});
export type ApplyStateInput = z.infer<typeof applyStateInput>;

export const applyStateResult = z.object({
  appliedVersion: z.number().int().nonnegative(),
  appliedHash: z.string().min(1),
});
export type ApplyStateResult = z.infer<typeof applyStateResult>;

// Hello is agent → api-server. Defined here for the shared shape; the route
// itself lives on the harness API (see api-server-api/runtime).
export const helloInput = z.object({
  lastAppliedVersion: z.number().int().nonnegative().optional(),
  lastAppliedHash: z.string().optional(),
  protocolVersion: z.literal("v1"),
  agentRuntimeVersion: z.string(),
  capabilities,
});
export type HelloInput = z.infer<typeof helloInput>;

export const helloResult = z.object({
  // Present iff the server has a payload the agent diverged from. Absent
  // means "you're in sync, nothing to apply."
  version: z.number().int().positive().optional(),
  state: stateSlice.optional(),
  events: z.array(event),
});
export type HelloResult = z.infer<typeof helloResult>;
