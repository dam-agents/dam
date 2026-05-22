/**
 * Wire contract for the unified runtime channel (ADR-048).
 *
 * Two directions share the event shapes:
 *
 *   server → agent  — `applyState` (snapshot) + `deliverSignal` (event).
 *                     Defined as tRPC routes in `agent-runtime-api`, which
 *                     imports the event schemas from this file.
 *   agent → server  — `hello` + `ack`, served by the harness API server at
 *                     `/api/agents/:id/runtime/v1/*`. Path identifies the
 *                     agent (Istio AuthorizationPolicy pins principal == :id
 *                     per ADR-041); payloads do not repeat the agent id.
 *
 * `hello` returns the current desired state (when the agent's reported
 * hash diverged) plus all pending signals. The server does NOT delete
 * those signal rows; `ack` is the only delete path. The agent
 * deduplicates by signal id against its in-flight set.
 */
import { z } from "zod";

/** Discriminated union of contribution kinds the agent can be asked to
 *  materialize. New kinds slot in here; agents that don't advertise the
 *  kind in their `hello.capabilities.kinds` get the contribution filtered
 *  out before delivery. See ADR-047 / ADR-048. */
export const contributionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    path: z.string().min(1),
    content: z.string(),
    /** How the agent merges this file with whatever's already on disk.
     *  `overwrite` (default) replaces the file; `section-marker` rewrites
     *  the marker-delimited block; `yaml-fill-if-missing` only writes
     *  top-level keys absent from the existing YAML — see ADR-048. */
    mergeMode: z
      .enum(["overwrite", "section-marker", "yaml-fill-if-missing"])
      .default("overwrite"),
    /** Marker label for `section-marker` mode. Ignored for other modes. */
    sectionMarker: z.string().optional(),
  }),
  z.object({
    kind: z.literal("mcp-entry"),
    /** Server name as the key under `mcpServers` in `.mcp.json`. */
    name: z.string().min(1),
    /** Raw entry value — keeps us future-proof against MCP transport
     *  evolutions without burning a contract revision. */
    entry: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal("skill-ref"),
    source: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    skillPaths: z.array(z.string().min(1)).min(1),
  }),
]);

export type Contribution = z.infer<typeof contributionSchema>;

export const stateEventSchema = z.object({
  /** Monotonic per-agent version. The agent ignores any apply call with a
   *  version <= its currently-applied version (cross-replica race
   *  defense). See ADR-048. */
  version: z.string().min(1),
  /** Stable content hash of the post-filter contribution set. The agent
   *  returns it in the next `hello` so the worker can short-circuit
   *  no-op deliveries. */
  hash: z.string().min(1),
  contributions: z.array(contributionSchema),
});

export type StateEvent = z.infer<typeof stateEventSchema>;

export const signalEventSchema = z.object({
  id: z.string().min(1),
  action: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  /** ISO-8601 expiry. The agent silently drops signals whose ttl has
   *  elapsed before it could process them. */
  expiresAt: z.string().min(1),
});

export type SignalEvent = z.infer<typeof signalEventSchema>;

export const runtimeChannelCapabilitiesSchema = z.object({
  /** Contribution kinds the agent's driver registry can materialize.
   *  Server-side rendering filters the state snapshot against this set;
   *  contributions of any other kind are silently dropped (and counted
   *  for observability). */
  kinds: z.array(z.string().min(1)),
  /** Signal action ids the agent knows how to handle. Signals targeted
   *  at an unknown action are not enqueued. */
  signals: z.array(z.string().min(1)),
});

export type RuntimeChannelCapabilities = z.infer<
  typeof runtimeChannelCapabilitiesSchema
>;

export const runtimeChannelHelloInputSchema = z.object({
  /** Build-time version embedded in the agent image. Reported for
   *  observability and future capability-vs-version reconciliation. */
  runtimeVersion: z.string().min(1),
  capabilities: runtimeChannelCapabilitiesSchema,
  /** Hash of the state the agent last successfully applied (echoed from
   *  the last `applyState` result). Empty string when the agent has
   *  never applied state. */
  lastAppliedHash: z.string(),
});

export type RuntimeChannelHelloInput = z.infer<
  typeof runtimeChannelHelloInputSchema
>;

export const runtimeChannelHelloResultSchema = z.object({
  /** Present when the server's current desired state hash diverges from
   *  the agent's `lastAppliedHash`. Absent means "you're current — keep
   *  doing what you're doing." */
  state: stateEventSchema.optional(),
  /** All signals currently queued for this agent. The server does NOT
   *  delete these rows; ack is the only delete path. The agent
   *  deduplicates by signal id against its in-flight set. */
  pendingSignals: z.array(signalEventSchema),
});

export type RuntimeChannelHelloResult = z.infer<
  typeof runtimeChannelHelloResultSchema
>;

export const runtimeChannelAckInputSchema = z.object({
  signalId: z.string().min(1),
});

export type RuntimeChannelAckInput = z.infer<
  typeof runtimeChannelAckInputSchema
>;

export const runtimeChannelAckResultSchema = z.object({
  ok: z.literal(true),
});

export type RuntimeChannelAckResult = z.infer<
  typeof runtimeChannelAckResultSchema
>;

export const runtimeChannelApplyStateResultSchema = z.object({
  /** Hash of the state the agent now believes it's applied. Either echoes
   *  back the input hash on success, or returns the previous hash when
   *  the agent rejected the apply (older version, missing capability). */
  appliedHash: z.string().min(1),
  rejected: z
    .object({
      reason: z.enum(["older-version", "missing-capability"]),
    })
    .optional(),
});

export type RuntimeChannelApplyStateResult = z.infer<
  typeof runtimeChannelApplyStateResultSchema
>;
