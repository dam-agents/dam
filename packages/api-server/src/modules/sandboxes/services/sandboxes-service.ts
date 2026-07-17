import { randomBytes } from "node:crypto";
import Ajv, { type ValidateFunction } from "ajv";
import type { AgentsService } from "api-server-api";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { buildSandboxPrompt } from "../domain/sandbox-prompt.js";
import type {
  SandboxesRepository,
  SandboxStatus,
} from "../infrastructure/sandboxes-repository.js";

/** How long a sandbox may run before the liveness sweep fails it (silent-exit
 *  backstop — the handoff's "a step that ends silently wedges the loop"). The
 *  driver picks the deadline per node via `ttlMs`: a long-running Make raises it,
 *  a node expected to reply quickly lowers it so a misconfigured or wedged node
 *  fails in minutes instead of hanging to the default hour. */
export const DEFAULT_SANDBOX_TTL_MS = 60 * 60 * 1000;
/** Lower bound — a node needs at least this long to boot and run a turn. */
export const MIN_SANDBOX_TTL_MS = 60 * 1000;
/** Upper bound — the hard ceiling on how long one node may occupy compute. */
export const MAX_SANDBOX_TTL_MS = 6 * 60 * 60 * 1000;

/** Clamp a requested TTL into the allowed range, defaulting when unset. */
export function resolveSandboxTtlMs(ttlMs: number | undefined): number {
  if (ttlMs === undefined) return DEFAULT_SANDBOX_TTL_MS;
  return Math.min(MAX_SANDBOX_TTL_MS, Math.max(MIN_SANDBOX_TTL_MS, ttlMs));
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
  /** JSON Schema the node_done result is validated against. */
  schema: unknown;
  /** Liveness deadline for this node, clamped to
   *  [MIN_SANDBOX_TTL_MS, MAX_SANDBOX_TTL_MS]; defaults to
   *  DEFAULT_SANDBOX_TTL_MS when unset. */
  ttlMs?: number;
  /** Resource limits for the node (K8s cpu/memory). A heavy Make needs more than
   *  the template's default memory (a 1Gi default OOM-kills a clone + install).
   *  Omitted dimensions inherit the template. */
  size?: { cpu?: string; memory?: string };
}

export interface RecordResult {
  ok: boolean;
  /** Populated when ok is false: why the result was rejected. */
  errors?: string;
}

export interface SandboxesService {
  spawn(input: SpawnInput): Promise<{ id: string }>;
  get(
    sandboxId: string,
    driverAgentId: string,
  ): Promise<{ status: SandboxStatus; result: unknown } | null>;
  /** node_done: validate the result against the stashed schema, store it, and
   *  mark the sandbox done. Attribution is by the reporting agent's own id. */
  recordResult(sandboxId: string, result: unknown): Promise<RecordResult>;
}

export function createSandboxesService(deps: {
  owner: string;
  repo: SandboxesRepository;
  agents: AgentsService;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  now?: () => Date;
}): SandboxesService {
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
      // Attenuation: a sandbox may only carry a subset of the driver's grants.
      const grantSet = new Set(input.driverGrantIds);
      const offending = input.connections.filter((c) => !grantSet.has(c));
      if (offending.length > 0) throw new AttenuationError(offending);

      // Fail fast on a malformed schema so the driver hears about it now, not
      // via a node that can never pass validation.
      compileSchema(input.schema);

      const agent = await deps.agents.create({
        name: `sandbox-${randomBytes(6).toString("hex")}`,
        ...(input.templateId ? { templateId: input.templateId } : {}),
        ...(input.image ? { image: input.image } : {}),
        ...(input.connections.length
          ? { connectionIds: input.connections }
          : {}),
        ...(input.size ? { size: input.size } : {}),
      });

      const expiresAt = new Date(
        now().getTime() + resolveSandboxTtlMs(input.ttlMs),
      );
      await deps.repo.insert({
        id: agent.id,
        driverAgentId: input.driverAgentId,
        owner: deps.owner,
        resultSchema: input.schema,
        expiresAt,
      });

      // Deliver the one-shot prompt (carrying the node_done contract + schema)
      // via the trigger rail, then wake the fresh agent so it drains it.
      const task = buildSandboxPrompt({
        prompt: input.prompt,
        resultSchema: input.schema,
      });
      await deps.runtimeMutator.bump(agent.id, [
        {
          id: `sandbox:${agent.id}:${now().getTime()}`,
          kind: "trigger",
          payload: {
            scheduleId: `sandbox:${agent.id}`,
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

    async get(sandboxId, driverAgentId) {
      const row = await deps.repo.get(sandboxId);
      // Scope reads to the driver that spawned it.
      if (!row || row.driverAgentId !== driverAgentId) return null;
      return { status: row.status, result: row.result };
    },

    async recordResult(sandboxId, result) {
      const row = await deps.repo.get(sandboxId);
      if (!row) {
        return { ok: false, errors: "no sandbox is active for this agent" };
      }
      if (row.status !== "running") {
        return { ok: false, errors: `sandbox already ${row.status}` };
      }
      const validate = compileSchema(row.resultSchema);
      if (!validate(result)) {
        return { ok: false, errors: ajv.errorsText(validate.errors) };
      }
      const stored = await deps.repo.complete(sandboxId, result);
      if (!stored) {
        // Lost a race with the liveness sweep — the sandbox was just failed.
        return { ok: false, errors: "sandbox is no longer running" };
      }
      return { ok: true };
    },
  };
}
