import { randomBytes } from "node:crypto";
import Ajv, { type ValidateFunction } from "ajv";
import type { AgentsService } from "api-server-api";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { buildInvocationPrompt } from "../domain/invocation-prompt.js";
import type {
  InvocationsRepository,
  InvocationStatus,
} from "../infrastructure/invocations-repository.js";

/** How long an Invocation may run before the liveness sweep fails it
 *  (silent-exit backstop — "a step that ends silently wedges the loop"). The
 *  driver picks the deadline per target via `ttlMs`: a long-running Make raises
 *  it, a target expected to reply quickly lowers it so a misconfigured or
 *  wedged target fails in minutes instead of hanging to the default hour. This
 *  bounds one result, not the agent — the agent's own lifetime is the Agent
 *  Sweep's concern. */
export const DEFAULT_INVOCATION_TTL_MS = 60 * 60 * 1000;
/** Lower bound — a target needs at least this long to boot and run a turn. */
export const MIN_INVOCATION_TTL_MS = 60 * 1000;
/** Upper bound — the hard ceiling on how long one target may occupy compute. */
export const MAX_INVOCATION_TTL_MS = 6 * 60 * 60 * 1000;

/** Clamp a requested TTL into the allowed range, defaulting when unset. */
export function resolveInvocationTtlMs(ttlMs: number | undefined): number {
  if (ttlMs === undefined) return DEFAULT_INVOCATION_TTL_MS;
  return Math.min(
    MAX_INVOCATION_TTL_MS,
    Math.max(MIN_INVOCATION_TTL_MS, ttlMs),
  );
}

/** Thrown by `spawn` when the requested connections aren't a subset of the
 *  driver's own grants. The endpoint maps this to 403. */
export class AttenuationError extends Error {
  constructor(public readonly offending: string[]) {
    super(`connections not granted to the driver: ${offending.join(", ")}`);
    this.name = "AttenuationError";
  }
}

/** Thrown by `spawn` when the driver supplies a malformed JSON Schema. The
 *  endpoint maps this to 400. */
export class InvalidSchemaError extends Error {
  constructor(detail: string) {
    super(`invalid result schema: ${detail}`);
    this.name = "InvalidSchemaError";
  }
}

export interface SpawnInput {
  driverAgentId: string;
  /** The driver's own granted connection ids — the attenuation ceiling. */
  driverGrantIds: string[];
  templateId?: string;
  image?: string;
  connections: string[];
  prompt: string;
  /** JSON Schema the report_result result is validated against. */
  schema: unknown;
  /** Liveness deadline for this target, clamped to
   *  [MIN_INVOCATION_TTL_MS, MAX_INVOCATION_TTL_MS]; defaults to
   *  DEFAULT_INVOCATION_TTL_MS when unset. */
  ttlMs?: number;
  /** Resource limits for the target (K8s cpu/memory). A heavy Make needs more
   *  than the template's default memory (a 1Gi default OOM-kills a clone +
   *  install). Omitted dimensions inherit the template. */
  size?: { cpu?: string; memory?: string };
}

export interface RecordResult {
  ok: boolean;
  /** Populated when ok is false: why the result was rejected. */
  errors?: string;
}

export interface InvocationsService {
  spawn(input: SpawnInput): Promise<{ id: string }>;
  get(
    invocationId: string,
    driverAgentId: string,
  ): Promise<{ status: InvocationStatus; result: unknown } | null>;
  /** report_result: validate the result against the stashed schema, store it,
   *  and mark the Invocation done. Attribution is by the reporting agent's own
   *  id. */
  recordResult(invocationId: string, result: unknown): Promise<RecordResult>;
}

export function createInvocationsService(deps: {
  owner: string;
  repo: InvocationsRepository;
  agents: AgentsService;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  now?: () => Date;
}): InvocationsService {
  const now = deps.now ?? (() => new Date());
  const ajv = new Ajv({ allErrors: true, strict: false });

  function compileSchema(schema: unknown): ValidateFunction {
    try {
      return ajv.compile(schema as object);
    } catch (err) {
      throw new InvalidSchemaError((err as Error).message);
    }
  }

  return {
    async spawn(input) {
      // Attenuation: a target may only carry a subset of the driver's grants.
      const grantSet = new Set(input.driverGrantIds);
      const offending = input.connections.filter((c) => !grantSet.has(c));
      if (offending.length > 0) throw new AttenuationError(offending);

      // Fail fast on a malformed schema so the driver hears about it now, not
      // via a target that can never pass validation.
      compileSchema(input.schema);

      // The target is a fresh ephemeral Agent, marked Sweepable so the Agent
      // Sweep reaps it once it hibernates — the backstop for the eager reap on
      // this Invocation reaching terminal. No Lifetime grace: an Invocation
      // target dies on hibernate.
      const agent = await deps.agents.create({
        name: `invocation-${randomBytes(6).toString("hex")}`,
        sweepable: true,
        ...(input.templateId ? { templateId: input.templateId } : {}),
        ...(input.image ? { image: input.image } : {}),
        ...(input.connections.length
          ? { connectionIds: input.connections }
          : {}),
        ...(input.size ? { size: input.size } : {}),
      });

      const expiresAt = new Date(
        now().getTime() + resolveInvocationTtlMs(input.ttlMs),
      );
      await deps.repo.insert({
        id: agent.id,
        driverAgentId: input.driverAgentId,
        owner: deps.owner,
        resultSchema: input.schema,
        expiresAt,
      });

      // Deliver the one-shot prompt (carrying the report_result contract +
      // schema) via the trigger rail, then wake the fresh agent so it drains it.
      const task = buildInvocationPrompt({
        prompt: input.prompt,
        resultSchema: input.schema,
      });
      await deps.runtimeMutator.bump(agent.id, [
        {
          id: `invocation:${agent.id}:${now().getTime()}`,
          kind: "trigger",
          payload: {
            scheduleId: `invocation:${agent.id}`,
            task,
            sessionMode: "fresh",
          },
          expiresAt,
        },
      ]);
      await deps.runtimeMutator.enqueueAfterCommit(agent.id);
      await deps.wakeAgent(agent.id);

      return { id: agent.id };
    },

    async get(invocationId, driverAgentId) {
      const row = await deps.repo.get(invocationId);
      // Scope reads to the driver that spawned it.
      if (!row || row.driverAgentId !== driverAgentId) return null;
      return { status: row.status, result: row.result };
    },

    async recordResult(invocationId, result) {
      const row = await deps.repo.get(invocationId);
      if (!row) {
        return { ok: false, errors: "no invocation is active for this agent" };
      }
      if (row.status !== "running") {
        return { ok: false, errors: `invocation already ${row.status}` };
      }
      const validate = compileSchema(row.resultSchema);
      if (!validate(result)) {
        return { ok: false, errors: ajv.errorsText(validate.errors) };
      }
      const stored = await deps.repo.complete(invocationId, result);
      if (!stored) {
        // Lost a race with the liveness sweep — the Invocation was just failed.
        return { ok: false, errors: "invocation is no longer running" };
      }
      // Eager reap: the Invocation is terminal, so the target Agent has served
      // its purpose — drop it now rather than wait for the Agent Sweep to catch
      // it on hibernate. Deleting the Agent ConfigMap cascades pod/gateway/PVC
      // via ownerReferences; that teardown is downstream and async, so this
      // tool response still flushes before the pod dies. Best-effort: if the
      // delete fails, the target is Sweepable, so the Agent Sweep reaps it once
      // it hibernates. The result row outlives the Agent (dropped later by the
      // liveness sweep's retention pass) so a slightly late poll still reads it.
      try {
        await deps.agents.delete(invocationId);
      } catch {
        // Swallowed: Sweepable is the backstop.
      }
      return { ok: true };
    },
  };
}
