import { randomBytes } from "node:crypto";
import { emit, EventType } from "../../../events.js";
import Ajv, { type ValidateFunction } from "ajv";
import {
  type AgentsService,
  DEFAULT_INVOCATION_TTL_MS,
  MIN_INVOCATION_TTL_MS,
  MAX_INVOCATION_TTL_MS,
} from "api-server-api";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { generateK8sName } from "../../agents/infrastructure/configmap-mappers.js";
import { buildInvocationPrompt } from "../domain/invocation-prompt.js";
import { invocationTargetName } from "../domain/target-name.js";
import type { DriverResolution } from "./driver-resolution.js";
import type {
  InvocationsRepository,
  InvocationStatus,
} from "../infrastructure/invocations-repository.js";

export {
  DEFAULT_INVOCATION_TTL_MS,
  MIN_INVOCATION_TTL_MS,
  MAX_INVOCATION_TTL_MS,
};

export function resolveInvocationTtlMs(ttlMs: number | undefined): number {
  if (ttlMs === undefined) return DEFAULT_INVOCATION_TTL_MS;
  return Math.min(
    MAX_INVOCATION_TTL_MS,
    Math.max(MIN_INVOCATION_TTL_MS, ttlMs),
  );
}

export class AttenuationError extends Error {
  constructor(public readonly offending: string[]) {
    super(`connections not granted to the driver: ${offending.join(", ")}`);
    this.name = "AttenuationError";
  }
}

export class ExperimentNotRunningError extends Error {
  constructor(experimentId: string) {
    super(
      `experiment ${experimentId} is not running; spawns attached to it are rejected`,
    );
    this.name = "ExperimentNotRunningError";
  }
}

export class UnresolvableDriverError extends Error {
  constructor(driverAgentId: string) {
    super(
      `driver chain could not be resolved; refusing to spawn an unattributable target (driver ${driverAgentId})`,
    );
    this.name = "UnresolvableDriverError";
  }
}

export class InvalidSchemaError extends Error {
  constructor(detail: string) {
    super(`invalid result schema: ${detail}`);
    this.name = "InvalidSchemaError";
  }
}

export interface SpawnInput {
  driverAgentId: string;
  driverGrantIds: string[];
  templateId?: string;
  image?: string;
  connections: string[];
  prompt: string;
  schema: unknown;
  ttlMs?: number;
  size?: { cpu?: string; memory?: string };
  experimentSpanId?: string;
}

export interface RecordResult {
  ok: boolean;
  errors?: string;
}

export interface InvocationsService {
  spawn(input: SpawnInput): Promise<{ id: string }>;
  get(
    invocationId: string,
    driverAgentId: string,
  ): Promise<{ status: InvocationStatus; result: unknown } | null>;
  recordResult(invocationId: string, result: unknown): Promise<RecordResult>;
}

export function createInvocationsService(deps: {
  owner: string;
  repo: InvocationsRepository;
  agents: AgentsService;
  driverResolution: DriverResolution;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  isExperimentRunning?: (
    experimentId: string,
    driverAgentId: string,
  ) => Promise<boolean>;
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

  function coerceResult(result: unknown, validate: ValidateFunction): unknown {
    if (validate(result)) return result;
    if (typeof result === "string") {
      try {
        const parsed: unknown = JSON.parse(result);
        if (validate(parsed)) return parsed;
      } catch {}
    }
    return result;
  }

  return {
    async spawn(input) {
      const grantSet = new Set(input.driverGrantIds);
      const offending = input.connections.filter((c) => !grantSet.has(c));
      if (offending.length > 0) throw new AttenuationError(offending);

      compileSchema(input.schema);

      if (input.experimentSpanId && deps.isExperimentRunning) {
        const experimentId = input.experimentSpanId.split("/", 1)[0]!;
        if (
          !(await deps.isExperimentRunning(experimentId, input.driverAgentId))
        ) {
          throw new ExperimentNotRunningError(experimentId);
        }
      }

      const rootId = await deps.driverResolution.resolveRoot(
        input.driverAgentId,
      );
      if (rootId === null) {
        throw new UnresolvableDriverError(input.driverAgentId);
      }

      const targetId = generateK8sName("agent");
      const expiresAt = new Date(
        now().getTime() + resolveInvocationTtlMs(input.ttlMs),
      );
      await deps.repo.insert({
        id: targetId,
        driverAgentId: input.driverAgentId,
        owner: deps.owner,
        resultSchema: input.schema,
        expiresAt,
        experimentSpanId: input.experimentSpanId ?? null,
      });
      let agent;
      try {
        agent = await deps.agents.create({
          id: targetId,
          name: invocationTargetName(randomBytes(6).toString("hex")),
          sweepable: true,
          egressPreset: "none",
          telemetryAttributionId: rootId,
          ...(input.templateId ? { templateId: input.templateId } : {}),
          ...(input.image ? { image: input.image } : {}),
          ...(input.connections.length
            ? { connectionIds: input.connections }
            : {}),
          ...(input.size ? { size: input.size } : {}),
        });
      } catch (err) {
        await deps.repo.delete(targetId).catch(() => {});
        throw err;
      }
      emit({
        type: EventType.InvocationSpawned,
        targetAgentId: targetId,
        driverAgentId: input.driverAgentId,
        ownerSub: deps.owner,
      });

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
      const value = coerceResult(result, validate);
      if (!validate(value)) {
        return { ok: false, errors: ajv.errorsText(validate.errors) };
      }
      const stored = await deps.repo.complete(invocationId, value);
      if (!stored) {
        return { ok: false, errors: "invocation is no longer running" };
      }
      try {
        await deps.agents.delete(invocationId);
      } catch {}
      return { ok: true };
    },
  };
}
