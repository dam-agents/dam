import { match } from "ts-pattern";
import { randomBytes } from "node:crypto";
import { emit, EventType } from "../../../events.js";
import Ajv, { type ValidateFunction } from "ajv";
import {
  type AgentSetup,
  type AgentsService,
  DEFAULT_INVOCATION_TTL_MS,
  type InvocationHarnessConfig,
  type InvocationView,
  MIN_INVOCATION_TTL_MS,
  MAX_INVOCATION_TTL_MS,
  type HarnessFamily,
  type ProviderPresetType,
  type SkillSetApplyResult,
  type SkillsService,
  parseQualifiedModel,
} from "api-server-api";
import {
  type RuntimeMutator,
  workspaceCommandEvent,
} from "../../runtime-delivery/index.js";
import { harnessConfigEvent } from "../../harness-config/index.js";
import { generateK8sName } from "../../agents/infrastructure/configmap-mappers.js";
import { createInputFromSetup } from "../../agents/index.js";
import type { SpendHoldGate, SpendHoldReason } from "../../spend/index.js";
import { getLogger } from "../../../core/logger.js";
import {
  type DriverProvider,
  inheritProvider,
  missingProviderMessage,
} from "../domain/provider-inheritance.js";
import { buildInvocationPrompt } from "../domain/invocation-prompt.js";
import { scriptDeadline } from "../domain/script-output.js";
import {
  invocationScheduleId,
  invocationTargetName,
} from "../domain/target-name.js";
import { createSetupFailure } from "./setup-failure.js";
import {
  HARNESS_CONFIG_STEP,
  type ReadHarnessConfigSupport,
} from "../domain/harness-config-refusal.js";
import { harnessConfigRefusalFor } from "./harness-config-check.js";
import type { DriverResolution } from "./driver-resolution.js";
import type { TargetReaper } from "./target-reaper.js";
import type { ReportedTargetReap } from "./reported-target-reap.js";
import type {
  InvocationOrigin,
  InvocationsRepository,
} from "../infrastructure/invocations-repository.js";

export class AttenuationError extends Error {
  constructor(public readonly offending: string[]) {
    super(`connections not granted to the driver: ${offending.join(", ")}`);
    this.name = "AttenuationError";
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

export class ModelNameError extends Error {
  constructor(model: string) {
    super(
      `name the target's model with its provider, as <provider>/<model id> (for example ibm/${model}); a tier name is no model`,
    );
    this.name = "ModelNameError";
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a sub-agent whose harness reaches its models
 * through the Model Router needs a model, and its runtime refuses a turn
 * without one; nothing named one (no platform sub-agent setting, no model in
 * the spawn, not the calling session's own harness), so the spawn is refused
 * at once instead of starting a sub-agent that cannot run.
 */
export const NO_SPAWN_MODEL_MESSAGE =
  "nothing names the sub-agent's model: pass a provider-qualified model (list_harnesses lists each harness's models), or spawn on this session's own harness to run on its model";

export class NoSpawnModelError extends Error {
  constructor() {
    super(NO_SPAWN_MODEL_MESSAGE);
    this.name = "NoSpawnModelError";
  }
}

export class ProviderMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderMismatchError";
  }
}

const SPEND_HOLD_MESSAGE: Record<SpendHoldReason, string> = {
  limit:
    "the agent reached its spend limit for today, so no sub-agent starts until its owner continues the limit or the day ends at midnight UTC",
  ceiling:
    "the agent's owner reached the spend ceiling for today, so no sub-agent starts until the UTC day ends; the platform operator can raise the ceiling",
};

export class SpendLimitReachedError extends Error {
  constructor(public readonly reason: SpendHoldReason) {
    super(SPEND_HOLD_MESSAGE[reason]);
    this.name = "SpendLimitReachedError";
  }
}

export class NoOutputStoreError extends Error {
  constructor() {
    super(
      "no object store is configured on this deployment, so a script sub-agent has nowhere to put its output",
    );
    this.name = "NoOutputStoreError";
  }
}

export interface SpawnTarget {
  templateId?: string;
  image?: string;
  harness?: HarnessFamily;
  runsOn?: ProviderPresetType[];
}

interface SpawnBase {
  driverAgentId: string;
  driverGrantIds: string[];
  target: SpawnTarget;
  setup: AgentSetup;
  connections: string[];
  label?: string;
  ttlMs?: number;
  origin?: InvocationOrigin;
  driverSessionId?: string | null;
}

export interface SpawnInput extends SpawnBase {
  driverProviders: DriverProvider[];
  attachableProviders?: ProviderPresetType[];
  prompt: string;
  schema: unknown;
  harnessConfig?: InvocationHarnessConfig;
}

export interface ScriptSpawnInput extends SpawnBase {
  script: string;
}

type TargetEvent = Parameters<RuntimeMutator["bump"]>[1][number];

interface LaunchWork {
  record: {
    prompt: string;
    script: string | null;
    resultSchema: unknown;
    harnessConfig: InvocationHarnessConfig | null;
  };
  providerConnectionId?: string;
  beforeInsert: (rootId: string) => Promise<void>;
  ahead: (agentId: string, at: Date, expiresAt: Date) => TargetEvent[];
  task: (agentId: string, at: Date, expiresAt: Date) => TargetEvent;
}

export interface RecordResult {
  ok: boolean;
  errors?: string;
}

export type Reachability =
  | { kind: "runs"; provider: ProviderPresetType }
  | { kind: "refused"; reason: string }
  | { kind: "unnarrowed" };

export interface InvocationsService {
  spawn(input: SpawnInput): Promise<{ id: string }>;
  spawnScript(input: ScriptSpawnInput): Promise<{ id: string }>;
  reachability(
    input: Pick<
      SpawnInput,
      "driverProviders" | "attachableProviders" | "target"
    >,
  ): Reachability;
  get(
    invocationId: string,
    driverAgentId: string,
  ): Promise<InvocationView | null>;
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
  readHarnessConfigSupport: ReadHarnessConfigSupport;
  scriptOutputsAvailable: boolean;
  spendHold?: SpendHoldGate;
  reaper: TargetReaper;
  reportedReap: Pick<ReportedTargetReap, "afterReport">;
  skills?: Pick<SkillsService, "applyEntries">;
  pinDriver?: (driverAgentId: string) => Promise<void>;
  now?: () => Date;
}): InvocationsService {
  const now = deps.now ?? (() => new Date());
  const ajv = new Ajv({ allErrors: true, strict: false });
  const failSetup = createSetupFailure({
    repo: deps.repo,
    reaper: deps.reaper,
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

  function assertAttenuated(input: SpawnBase): void {
    const grantSet = new Set(input.driverGrantIds);
    const offending = input.connections.filter((c) => !grantSet.has(c));
    if (offending.length > 0) throw new AttenuationError(offending);
  }

  async function launch(
    input: SpawnBase,
    work: LaunchWork,
  ): Promise<{ id: string }> {
    const created = createInputFromSetup(input.setup);
    const rootId = await deps.driverResolution.resolveRoot(input.driverAgentId);
    if (rootId === null) {
      throw new UnresolvableDriverError(input.driverAgentId);
    }
    await work.beforeInsert(rootId);

    const targetId = generateK8sName("agent");
    const ttlMs =
      input.ttlMs === undefined
        ? DEFAULT_INVOCATION_TTL_MS
        : Math.min(
            MAX_INVOCATION_TTL_MS,
            Math.max(MIN_INVOCATION_TTL_MS, input.ttlMs),
          );
    const expiresAt = new Date(now().getTime() + ttlMs);
    await deps.repo.insert({
      id: targetId,
      driverAgentId: input.driverAgentId,
      rootDriverId: rootId,
      owner: deps.owner,
      label: input.label ?? null,
      templateId: input.target.templateId ?? null,
      image: input.target.image ?? null,
      connections: input.connections,
      ttlMs,
      expiresAt,
      ...work.record,
      origin: input.origin ?? "script",
      driverSessionId: input.driverSessionId ?? null,
    });
    let agent;
    try {
      await deps.pinDriver?.(input.driverAgentId);
      agent = await deps.agents.create({
        id: targetId,
        name: invocationTargetName(randomBytes(6).toString("hex"), input.label),
        sweepable: true,
        egressPreset: "none",
        telemetryAttributionId: rootId,
        noDefaultProvider: true,
        ...(input.target.templateId
          ? { templateId: input.target.templateId }
          : {}),
        ...(input.target.image ? { image: input.target.image } : {}),
        ...(input.target.harness ? { harness: input.target.harness } : {}),
        ...created,
        ...(input.connections.length
          ? { connectionIds: input.connections }
          : {}),
        ...(work.providerConnectionId
          ? { providerConnectionId: work.providerConnectionId }
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

    const at = now();
    try {
      for (const event of work.ahead(agent.id, at, expiresAt)) {
        await deps.runtimeMutator.bump(agent.id, [event]);
      }
      if (input.setup.install)
        await deps.runtimeMutator.bump(agent.id, [
          workspaceCommandEvent(
            "invocation-install",
            agent.id,
            input.setup.install.command,
            at,
          ),
        ]);
      await deps.runtimeMutator.bump(agent.id, [
        work.task(agent.id, at, expiresAt),
      ]);
    } catch (err) {
      await deps.agents.delete(agent.id).catch(() => {});
      await deps.repo.delete(targetId).catch(() => {});
      throw err;
    }
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
  }

  return {
    reachability({ driverProviders, attachableProviders, target }) {
      const provider = inheritProvider(driverProviders, {
        runsOn: target.runsOn,
        ...(target.harness && { harness: target.harness }),
      });
      return match(provider)
        .with({ kind: "inherited" }, ({ id }): Reachability => {
          const held = driverProviders.find((p) => p.id === id);
          return held
            ? { kind: "runs", provider: held.type }
            : { kind: "unnarrowed" };
        })
        .with({ kind: "incompatible" }, (): Reachability => ({
          kind: "refused",
          reason: missingProviderMessage({
            harness: target.harness,
            runsOn: target.runsOn ?? [],
            held: driverProviders.map((p) => p.type),
            attachable: attachableProviders ?? [],
          }),
        }))
        .with({ kind: "none" }, (): Reachability => ({ kind: "unnarrowed" }))
        .exhaustive();
    },

    async spawn(input) {
      assertAttenuated(input);
      compileSchema(input.schema);

      const requestedModel = input.harnessConfig?.model;
      const parsedModel = requestedModel
        ? parseQualifiedModel(requestedModel, { claudePrefix: true })
        : null;
      if (requestedModel && !parsedModel)
        throw new ModelNameError(requestedModel);
      if (parsedModel && input.harnessConfig)
        input = {
          ...input,
          harnessConfig: {
            ...input.harnessConfig,
            model: `${parsedModel.alias}/${parsedModel.upstreamId}`,
          },
        };
      const provider = inheritProvider(input.driverProviders, {
        runsOn: input.target.runsOn,
        ...(parsedModel && { alias: parsedModel.alias }),
        ...(input.target.harness && { harness: input.target.harness }),
      });
      if (provider.kind === "incompatible")
        throw new ProviderMismatchError(
          missingProviderMessage({
            harness: input.target.harness,
            runsOn: input.target.runsOn ?? [],
            alias: parsedModel?.alias,
            held: input.driverProviders.map((p) => p.type),
            attachable: input.attachableProviders ?? [],
          }),
        );

      const routedProvider =
        provider.kind === "inherited" &&
        input.driverProviders.find((p) => p.id === provider.id)?.type !==
          "bedrock";
      if (!parsedModel && !input.target.image && routedProvider)
        throw new NoSpawnModelError();

      const harnessConfig = input.harnessConfig;
      return launch(input, {
        record: {
          prompt: input.prompt,
          script: null,
          resultSchema: input.schema,
          harnessConfig: harnessConfig ?? null,
        },
        ...(provider.kind === "inherited" && {
          providerConnectionId: provider.id,
        }),
        beforeInsert: async (rootId) => {
          const held = await deps.spendHold?.({
            agentId: rootId,
            ...(provider.kind === "inherited" && { connectionId: provider.id }),
          });
          if (held) throw new SpendLimitReachedError(held);
        },
        ahead: (agentId, at, expiresAt) =>
          harnessConfig
            ? [
                harnessConfigEvent(
                  agentId,
                  harnessConfig,
                  at.getTime(),
                  expiresAt,
                ),
              ]
            : [],
        task: (agentId, at, expiresAt) => ({
          id: `${invocationScheduleId(agentId)}:${at.getTime()}`,
          kind: "trigger",
          payload: {
            scheduleId: invocationScheduleId(agentId),
            task: buildInvocationPrompt({
              prompt: input.prompt,
              resultSchema: input.schema,
            }),
            sessionMode: "fresh",
            invocation: true,
            ...(input.target.harness && {
              harness: input.target.harness,
              ...(provider.kind === "inherited" && {
                provider: provider.id,
              }),
              ...(harnessConfig?.model && {
                model: harnessConfig.model,
              }),
            }),
          },
          expiresAt,
        }),
      });
    },

    async spawnScript(input) {
      assertAttenuated(input);
      if (!deps.scriptOutputsAvailable) throw new NoOutputStoreError();
      return launch(input, {
        record: {
          prompt: "",
          script: input.script,
          resultSchema: null,
          harnessConfig: null,
        },
        beforeInsert: () => Promise.resolve(),
        ahead: () => [],
        task: (agentId, at, expiresAt) => ({
          id: `${invocationScheduleId(agentId)}:${at.getTime()}`,
          kind: "invocation-script",
          payload: {
            command: input.script,
            deadline: scriptDeadline(at, expiresAt).toISOString(),
            reportBy: expiresAt.toISOString(),
          },
          expiresAt,
        }),
      });
    },

    async get(invocationId, driverAgentId) {
      const row = await deps.repo.get(invocationId);
      if (!row || row.driverAgentId !== driverAgentId) return null;
      return {
        status: row.status,
        result: row.result,
        errorReason: row.errorReason ?? undefined,
        ...(row.exitCode !== null && { exitCode: row.exitCode }),
        ...(row.script !== null && { output: row.output ?? {} }),
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
      if (row.script !== null) {
        return {
          ok: false,
          errors: "this invocation runs a script, which reports its own output",
        };
      }
      const refusal = await harnessConfigRefusalFor(
        row,
        deps.readHarnessConfigSupport,
      );
      if (refusal) {
        return {
          ok: false,
          errors: await failSetup(invocationId, HARNESS_CONFIG_STEP, refusal),
        };
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
      deps.reportedReap.afterReport({ id: row.id, owner: row.owner });
      return { ok: true };
    },
  };
}
