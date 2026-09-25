import { randomBytes } from "node:crypto";
import { emit, EventType } from "../../../events.js";
import Ajv, { type ValidateFunction } from "ajv";
import {
  type AgentSetup,
  type AgentsService,
  DEFAULT_INVOCATION_TTL_MS,
  MIN_INVOCATION_TTL_MS,
  MAX_INVOCATION_TTL_MS,
  type ProviderPresetType,
  type SkillSetApplyResult,
  type SkillsService,
} from "api-server-api";
import {
  type RuntimeMutator,
  workspaceCommandEvent,
} from "../../runtime-delivery/index.js";
import { generateK8sName } from "../../agents/infrastructure/configmap-mappers.js";
import { createInputFromSetup } from "../../agents/index.js";
import { getLogger } from "../../../core/logger.js";
import {
  type DriverProvider,
  inheritProvider,
} from "../domain/provider-inheritance.js";
import { buildInvocationPrompt } from "../domain/invocation-prompt.js";
import { invocationTargetName } from "../domain/target-name.js";
import { createSetupFailure } from "./setup-failure.js";
import type { DriverResolution } from "./driver-resolution.js";
import type { TargetAdmission } from "./target-admission.js";
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

export class ProviderMismatchError extends Error {
  constructor(offered: ProviderPresetType[], runsOn: ProviderPresetType[]) {
    super(
      `the target cannot run on the driver's provider (${offered.join(", ")}); it runs on ${runsOn.join(", ")}`,
    );
    this.name = "ProviderMismatchError";
  }
}

export interface SpawnTarget {
  templateId?: string;
  image?: string;
  runsOn?: ProviderPresetType[];
}

export interface SpawnInput {
  driverAgentId: string;
  driverGrantIds: string[];
  driverProviders: DriverProvider[];
  target: SpawnTarget;
  setup: AgentSetup;
  connections: string[];
  prompt: string;
  schema: unknown;
  label?: string;
  ttlMs?: number;
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

function skillsSkippedReason(
  skipped: SkillSetApplyResult["skipped"],
): string | null {
  if (skipped.length === 0) return null;
  return skipped.map((s) => `${s.name} (${s.reason})`).join(", ");
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
  targetAdmission?: TargetAdmission;
  skills?: Pick<SkillsService, "applyEntries">;
  pinDriver?: (driverAgentId: string) => Promise<void>;
  now?: () => Date;
}): InvocationsService {
  const now = deps.now ?? (() => new Date());
  const ajv = new Ajv({ allErrors: true, strict: false });
  const failSetup = createSetupFailure({
    repo: deps.repo,
    agentsFor: () => deps.agents,
  });

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

      const provider = inheritProvider(
        input.driverProviders,
        input.target.runsOn,
      );
      if (provider.kind === "incompatible")
        throw new ProviderMismatchError(
          provider.offered,
          input.target.runsOn ?? [],
        );

      const created = createInputFromSetup(input.setup);
      if (deps.targetAdmission) {
        await deps.targetAdmission.assertCanEverFit({
          ...(input.target.templateId
            ? { templateId: input.target.templateId }
            : {}),
          ...(created.size ? { size: created.size } : {}),
        });
      }

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
      await deps.pinDriver?.(input.driverAgentId);
      let agent;
      try {
        agent = await deps.agents.create({
          id: targetId,
          name: invocationTargetName(
            randomBytes(6).toString("hex"),
            input.label,
          ),
          sweepable: true,
          egressPreset: "none",
          telemetryAttributionId: rootId,
          ...(input.target.templateId
            ? { templateId: input.target.templateId }
            : {}),
          ...(input.target.image ? { image: input.target.image } : {}),
          ...created,
          ...(input.connections.length
            ? { connectionIds: input.connections }
            : {}),
          ...(provider.kind === "inherited"
            ? { providerConnectionId: provider.id }
            : {}),
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
      const at = now();
      await deps.runtimeMutator.bump(agent.id, [
        ...(input.setup.install
          ? [
              workspaceCommandEvent(
                "invocation-install",
                agent.id,
                input.setup.install.command,
                at,
              ),
            ]
          : []),
        {
          id: `invocation:${agent.id}:${at.getTime()}`,
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

      if (input.setup.skills.length > 0 && deps.skills) {
        let reason: string | null = null;
        try {
          const applied = await deps.skills.applyEntries({
            agentId: agent.id,
            skills: input.setup.skills,
          });
          reason = skillsSkippedReason(applied.skipped);
        } catch (err) {
          reason = err instanceof Error ? err.message : String(err);
        }
        if (reason !== null) {
          getLogger().warn(
            { agentId: agent.id, reason },
            "invocations: the target's skills could not be applied",
          );
          await failSetup(agent.id, "skills", reason);
        }
      }

      return { id: agent.id };
    },

    async get(invocationId, driverAgentId) {
      const row = await deps.repo.get(invocationId);
      if (!row || row.driverAgentId !== driverAgentId) return null;
      return {
        status: row.status,
        result: row.result,
        errorReason: row.errorReason ?? undefined,
      };
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
