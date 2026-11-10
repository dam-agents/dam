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
  type ChildConnections,
  type ChildEgress,
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
import {
  createInputFromSetup,
  subAgentCreateInput,
} from "../../agents/index.js";
import type { SpendHoldGate, SpendHoldReason } from "../../spend/index.js";
import { DEFAULT_KEEP_MS, keepUntil } from "../domain/keep.js";
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
import type { DelegationStop } from "./delegation-stop.js";
import { driverStopReason } from "../domain/stop-reason.js";
import type { RunCancel } from "./run-cancel.js";
import type { ReportedTargetReap } from "./reported-target-reap.js";
import type {
  InvocationOrigin,
  InvocationRow,
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

export class KeepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeepError";
  }
}

export class OpenEgressConnectionsError extends Error {
  constructor() {
    super(
      'a sub-agent with egress "open" holds no connections but its model: pass connections "none"',
    );
    this.name = "OpenEgressConnectionsError";
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
  connections: ChildConnections;
  egress?: ChildEgress;
  keep?: boolean;
  keepForMs?: number;
  idleTimeoutMin?: number;
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

export type ScriptSpawnBase = SpawnBase;

export class RunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunError";
  }
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
  task?: (
    agentId: string,
    runId: string,
    at: Date,
    expiresAt: Date,
  ) => TargetEvent;
}

// UNIT_BOUNDARY_DESCRIPTION: what a model run needs resolved before it starts, whether a spawn or a later run in a kept or clean slate target asks for it: the providers the target may run on (the driver's for a spawn, the target's own for a run), the target's harness, and the model.
interface TurnInput {
  driverProviders: DriverProvider[];
  attachableProviders?: ProviderPresetType[];
  target: SpawnTarget;
  harnessConfig?: InvocationHarnessConfig;
}

export interface RunTurn extends TurnInput {
  prompt: string;
  schema: unknown;
  // UNIT_BOUNDARY_DESCRIPTION: the driver named the run's model rather than leaving its default; a continued session changes to a named model and otherwise keeps its own.
  modelNamed?: boolean;
  // UNIT_BOUNDARY_DESCRIPTION: which of the target's sessions the turn runs in: left out, the session of its latest prompt run; "new", a session of its own; or a session an earlier run's result named.
  session?: string;
}

export type RunWork = RunTurn | { script: string };

export interface StartedRun {
  run: string;
  session: string | null;
}

export interface RunCaller {
  ttlMs?: number;
  origin: InvocationOrigin;
  driverSessionId: string | null;
}

const CANCEL_WAIT_MS = 60_000;
const CANCEL_POLL_MS = 3_000;
const SESSION_SEARCH_RUNS = 500;
export const NEW_SESSION = "new";

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
  // UNIT_BOUNDARY_DESCRIPTION: a clean slate: the target boots with its setup and runs nothing, idle, until its driver starts a run in it; the driver can enter it over the link meanwhile. Not kept, it is removed once its spawn's time limit passes with no run.
  spawnIdle(input: SpawnInput | ScriptSpawnBase): Promise<{ id: string }>;
  // UNIT_BOUNDARY_DESCRIPTION: starts a run in a target that is idle, or kept: a task (with the schema its result must match) or a script, on the same machine with its files, under a fresh time limit, beside any run still running there, refused for the same reasons a spawn is; its result goes to the caller that started it. A task continues one of the target's sessions or starts its own. Refused for a target that is not the driver's or is gone, for an unkept one that ran already, and for a session a run is still working in; a session whose last run is still being ended is waited for a while.
  runSubagent(
    invocationId: string,
    driverAgentId: string,
    run: RunWork,
    caller: RunCaller,
  ): Promise<StartedRun>;
  // UNIT_BOUNDARY_DESCRIPTION: wakes a sleeping sub-agent of the driver's, so it can be entered over the link; refused for one that is not the driver's, is gone, or whose machine is being stopped.
  wakeTarget(invocationId: string, driverAgentId: string): Promise<void>;
  // UNIT_BOUNDARY_DESCRIPTION: the driver's stop of a sub-agent of its own, which takes every sub-agent below it down too; nothing of it comes back to the driver as a turn. A kept sub-agent is stopped only with a reason, since it lives on and its user reads why its work was cut short. Refused for one that is not the driver's.
  stopTarget(
    invocationId: string,
    driverAgentId: string,
    reason?: string,
  ): Promise<{ stopped: boolean }>;
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
  // UNIT_BOUNDARY_DESCRIPTION: a target's result, for the run the reporting session is working on, which also names that session as the run's; a report that names no run (from a runtime that cannot say) is taken for the target's latest run.
  recordResult(
    invocationId: string,
    result: unknown,
    reporting?: { run: string; sessionId: string | null } | null,
  ): Promise<RecordResult>;
  // UNIT_BOUNDARY_DESCRIPTION: moves a kept target's keep expiry to `keepForMs` from now, or the idle time after which its machine sleeps; only its driver may, and only for a target spawned with keep.
  extendKeep(
    invocationId: string,
    driverAgentId: string,
    change: { keepForMs?: number; idleTimeoutMin?: number },
  ): Promise<{ keepUntil: Date; idleTimeoutMin?: number }>;
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
  stopper: DelegationStop;
  cancel: Pick<RunCancel, "settled">;
  reportedReap: Pick<ReportedTargetReap, "afterReport">;
  skills?: Pick<SkillsService, "applyEntries">;
  pinDriver?: (driverAgentId: string) => Promise<void>;
  readStartWait?: (agentId: string) => Promise<string | null>;
  keepMaxMs?: number;
  idleTimeoutMaxMin?: number;
  cancelWaitMs?: number;
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
    const open =
      input.egress === "open" ||
      (typeof input.egress === "object" && "open" in input.egress);
    if (open && input.connections !== "none")
      throw new OpenEgressConnectionsError();
    if (!Array.isArray(input.connections)) return;
    const grantSet = new Set(input.driverGrantIds);
    const offending = input.connections.filter((c) => !grantSet.has(c));
    if (offending.length > 0) throw new AttenuationError(offending);
  }

  // UNIT_BOUNDARY_DESCRIPTION: the connections a spawn gives its target, as the target's inheritance records them: all of the driver's grants, mirrored from then on, for `parent`; none for `none`; the named ones, copied once, for a list.
  function inheritedConnections(input: SpawnBase): {
    connectionsFrom: "parent" | "subset" | "none";
    connectionIds: string[];
  } {
    if (input.connections === "parent")
      return { connectionsFrom: "parent", connectionIds: input.driverGrantIds };
    if (input.connections === "none")
      return { connectionsFrom: "none", connectionIds: [] };
    return { connectionsFrom: "subset", connectionIds: input.connections };
  }

  // UNIT_BOUNDARY_DESCRIPTION: a kept target's idle time before its machine sleeps, cut to the longest an Environment may take; a kept target always sleeps when idle, since awake it holds its share of its owner's memory.
  function idleMinutes(requested: number): number {
    return Math.min(
      Math.max(1, requested),
      deps.idleTimeoutMaxMin ?? requested,
    );
  }

  function taskEventId(agentId: string, at: Date): string {
    return `${invocationScheduleId(agentId)}:${at.getTime()}`;
  }

  // UNIT_BOUNDARY_DESCRIPTION: the model a run names, written as <provider>/<model id>, and the provider it runs on, which must be one the target may use; a run on a routed provider that names no model is refused, as its runtime would refuse the turn.
  function resolveTurn(input: TurnInput): {
    harnessConfig: InvocationHarnessConfig | undefined;
    provider: ReturnType<typeof inheritProvider>;
  } {
    const requestedModel = input.harnessConfig?.model;
    const parsedModel = requestedModel
      ? parseQualifiedModel(requestedModel, { claudePrefix: true })
      : null;
    if (requestedModel && !parsedModel)
      throw new ModelNameError(requestedModel);
    const harnessConfig =
      parsedModel && input.harnessConfig
        ? {
            ...input.harnessConfig,
            model: `${parsedModel.alias}/${parsedModel.upstreamId}`,
          }
        : input.harnessConfig;
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
    return { harnessConfig, provider };
  }

  async function holdSpend(
    rootId: string,
    provider: ReturnType<typeof inheritProvider>,
  ): Promise<void> {
    const held = await deps.spendHold?.({
      agentId: rootId,
      ...(provider.kind === "inherited" && { connectionId: provider.id }),
    });
    if (held) throw new SpendLimitReachedError(held);
  }

  function turnEvent(
    agentId: string,
    runId: string,
    expiresAt: Date,
    turn: {
      prompt: string;
      schema: unknown;
      harness: HarnessFamily | undefined;
      provider: ReturnType<typeof inheritProvider>;
      harnessConfig: InvocationHarnessConfig | undefined;
      session?: string | null;
      modelNamed?: boolean;
    },
  ): TargetEvent {
    const continues = !!turn.session;
    return {
      id: runId,
      kind: "trigger",
      payload: {
        scheduleId: invocationScheduleId(agentId),
        task: buildInvocationPrompt({
          prompt: turn.prompt,
          resultSchema: turn.schema,
          continues,
        }),
        sessionMode: "fresh",
        invocation: true,
        ...(turn.session && { invocationSession: turn.session }),
        ...(turn.harness && {
          harness: turn.harness,
          ...(turn.provider.kind === "inherited" && {
            provider: turn.provider.id,
          }),
          ...(turn.harnessConfig?.model &&
            (!continues || turn.modelNamed) && {
              model: turn.harnessConfig.model,
            }),
        }),
      },
      expiresAt,
    };
  }

  function scriptEvent(
    runId: string,
    command: string,
    at: Date,
    expiresAt: Date,
  ): TargetEvent {
    return {
      id: runId,
      kind: "invocation-script",
      payload: {
        command,
        deadline: scriptDeadline(at, expiresAt).toISOString(),
        reportBy: expiresAt.toISOString(),
      },
      expiresAt,
    };
  }

  // UNIT_BOUNDARY_DESCRIPTION: waits, bounded, for the run of a session that failed while its turn may still run to be ended, so the session's next run never starts beside it.
  async function awaitCancel(run: InvocationRow): Promise<boolean> {
    const until = now().getTime() + (deps.cancelWaitMs ?? CANCEL_WAIT_MS);
    for (;;) {
      const current = await deps.repo.getRun(run.runId!);
      if (!current?.cancelPending) return true;
      if (await deps.cancel.settled(current)) return true;
      if (now().getTime() >= until) return false;
      await new Promise((r) => setTimeout(r, CANCEL_POLL_MS));
    }
  }

  // UNIT_BOUNDARY_DESCRIPTION: the session a prompt run continues, or null for a session of its own: the one named (which an earlier run of the target must have run in), or, named none, the session of the target's latest prompt run, else the newest session one of its runs is known by, since a run that failed before it said which session it ran in leaves none. A session a run is still working in is refused; one whose last run is still being ended is waited for.
  async function sessionFor(
    row: InvocationRow,
    named: string | undefined,
  ): Promise<string | null> {
    if (named === NEW_SESSION) return null;
    const turns = (
      await deps.repo.listRuns(row.id, SESSION_SEARCH_RUNS)
    ).filter((r) => r.script === null);
    const latest = turns[0];
    if (named === undefined && latest?.status === "running")
      throw new RunError(
        `${row.id}'s latest prompt run ${latest.runId} is still running in its session; await it, or pass session "${NEW_SESSION}" to run beside it`,
      );
    const session =
      named ??
      latest?.sessionId ??
      turns.find((r) => r.sessionId !== null)?.sessionId ??
      null;
    if (session === null) return null;
    const inSession = turns.filter((r) => r.sessionId === session);
    if (named !== undefined && inSession.length === 0)
      throw new RunError(
        `${named} is not a session of ${row.id}; each prompt run's result names the session it ran in`,
      );
    const busy = inSession.find((r) => r.status === "running");
    if (busy)
      throw new RunError(
        `run ${busy.runId} is still working in session ${session}; await it, or pass session "${NEW_SESSION}" to run beside it`,
      );
    const ending = inSession.find((r) => r.cancelPending);
    if (ending && !(await awaitCancel(ending)))
      throw new RunError(
        `session ${session} is still ending its last run, which failed; run in it again in a minute, or pass session "${NEW_SESSION}"`,
      );
    return session;
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
    const at = now();
    const runId = work.task ? taskEventId(targetId, at) : null;
    const ttlMs =
      input.ttlMs === undefined
        ? DEFAULT_INVOCATION_TTL_MS
        : Math.min(
            MAX_INVOCATION_TTL_MS,
            Math.max(MIN_INVOCATION_TTL_MS, input.ttlMs),
          );
    const expiresAt = new Date(now().getTime() + ttlMs);
    const tasksExpireAt = new Date(expiresAt.getTime() + ttlMs);
    const kept = input.keep
      ? keepUntil(now(), input.keepForMs, deps.keepMaxMs ?? DEFAULT_KEEP_MS)
      : null;
    if (kept && !(kept instanceof Date)) throw new KeepError(kept.error);
    if (input.idleTimeoutMin !== undefined && !kept)
      throw new KeepError(
        "idleTimeout goes with keep: a sub-agent that is not kept is removed after its result",
      );
    await deps.repo.insert(
      {
        id: targetId,
        driverAgentId: input.driverAgentId,
        rootDriverId: rootId,
        owner: deps.owner,
        label: input.label ?? null,
        templateId: input.target.templateId ?? null,
        image: input.target.image ?? null,
        connections: inheritedConnections(input).connectionIds,
        ttlMs,
        expiresAt,
        keepUntil: kept,
        harnessConfig: work.record.harnessConfig,
        driverSessionId: input.driverSessionId ?? null,
      },
      runId
        ? {
            runId,
            prompt: work.record.prompt,
            script: work.record.script,
            resultSchema: work.record.resultSchema,
            ttlMs,
            expiresAt,
            origin: input.origin ?? "script",
            driverSessionId: input.driverSessionId ?? null,
            sessionId: null,
          }
        : null,
    );
    let agent;
    try {
      await deps.pinDriver?.(input.driverAgentId);
      agent = await deps.agents.create(
        subAgentCreateInput({
          parentAgentId: input.driverAgentId,
          id: targetId,
          name: invocationTargetName(
            randomBytes(6).toString("hex"),
            input.label,
          ),
          rootAgentId: rootId,
          templateId: input.target.templateId,
          image: input.target.image,
          harness: input.target.harness,
          setup: created,
          ...inheritedConnections(input),
          ...(input.egress ? { egress: input.egress } : {}),
          ...(kept || runId === null ? { sleepsBetweenRuns: true } : {}),
          ...(input.idleTimeoutMin !== undefined && {
            hibernationTimeoutMin: idleMinutes(input.idleTimeoutMin),
          }),
          ...(work.providerConnectionId
            ? { providerConnectionId: work.providerConnectionId }
            : {}),
        }),
      );
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

    try {
      for (const event of work.ahead(agent.id, at, tasksExpireAt)) {
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
      if (work.task && runId)
        await deps.runtimeMutator.bump(agent.id, [
          work.task(agent.id, runId, at, tasksExpireAt),
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
      const { harnessConfig, provider } = resolveTurn(input);
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
        beforeInsert: (rootId) => holdSpend(rootId, provider),
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
        task: (agentId, runId, _at, expiresAt) =>
          turnEvent(agentId, runId, expiresAt, {
            prompt: input.prompt,
            schema: input.schema,
            harness: input.target.harness,
            provider,
            harnessConfig,
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
        task: (_agentId, runId, at, expiresAt) =>
          scriptEvent(runId, input.script, at, expiresAt),
      });
    },

    async spawnIdle(input) {
      assertAttenuated(input);
      const provider =
        "driverProviders" in input
          ? inheritProvider(input.driverProviders, {
              runsOn: input.target.runsOn,
              ...(input.target.harness && { harness: input.target.harness }),
            })
          : null;
      return launch(input, {
        record: {
          prompt: "",
          script: null,
          resultSchema: null,
          harnessConfig: null,
        },
        ...(provider?.kind === "inherited" && {
          providerConnectionId: provider.id,
        }),
        beforeInsert: () => Promise.resolve(),
        ahead: () => [],
      });
    },

    async runSubagent(invocationId, driverAgentId, run, caller) {
      const row = await deps.repo.get(invocationId);
      if (!row || row.driverAgentId !== driverAgentId)
        throw new RunError(`${invocationId} is not a sub-agent of yours`);
      if (row.reapedAt)
        throw new RunError(
          `${invocationId} was removed after its result; spawn with keep to run in a sub-agent more than once`,
        );
      if (row.status !== "idle" && !row.keepUntil)
        throw new RunError(
          `${invocationId} was not spawned with keep, so it is removed after its result and takes no more runs`,
        );
      const at = now();
      if (row.keepUntil && row.keepUntil.getTime() <= at.getTime())
        throw new RunError(
          `${invocationId}'s keep ended, so it is being removed and takes no more runs`,
        );
      if (!row.keepUntil && row.expiresAt.getTime() <= at.getTime())
        throw new RunError(
          `${invocationId} waited past its time limit with no run, so it is being removed`,
        );
      if ("script" in run && !deps.scriptOutputsAvailable)
        throw new NoOutputStoreError();
      let turn: ReturnType<typeof resolveTurn> | null = null;
      let session: string | null = null;
      if ("prompt" in run) {
        compileSchema(run.schema);
        turn = resolveTurn(run);
        await holdSpend(row.rootDriverId, turn.provider);
        session = await sessionFor(row, run.session);
      }

      const limit =
        caller.ttlMs === undefined
          ? (row.ttlMs ?? DEFAULT_INVOCATION_TTL_MS)
          : Math.min(
              MAX_INVOCATION_TTL_MS,
              Math.max(MIN_INVOCATION_TTL_MS, caller.ttlMs),
            );
      const startAt = now();
      const runId = taskEventId(invocationId, startAt);
      const expiresAt = new Date(startAt.getTime() + limit);
      const tasksExpireAt = new Date(expiresAt.getTime() + limit);
      const begun = await deps.repo.beginRun(invocationId, {
        runId,
        prompt: "prompt" in run ? run.prompt : "",
        script: "script" in run ? run.script : null,
        resultSchema: "prompt" in run ? run.schema : null,
        ttlMs: limit,
        expiresAt,
        origin: caller.origin,
        driverSessionId: caller.driverSessionId,
        sessionId: session,
      });
      if (begun === "session-busy")
        throw new RunError(
          `another run started in session ${session} meanwhile; await it, or pass session "${NEW_SESSION}"`,
        );
      if (begun !== "begun")
        throw new RunError(`${invocationId} cannot take a run right now`);
      await deps.runtimeMutator.bump(invocationId, [
        "script" in run
          ? scriptEvent(runId, run.script, startAt, tasksExpireAt)
          : turnEvent(invocationId, runId, tasksExpireAt, {
              prompt: run.prompt,
              schema: run.schema,
              harness: run.target.harness,
              provider: turn!.provider,
              harnessConfig: turn!.harnessConfig,
              session,
              ...(run.modelNamed !== undefined && {
                modelNamed: run.modelNamed,
              }),
            }),
      ]);
      await deps.wakeAgent(invocationId).catch(() => {});
      return { run: runId, session };
    },

    async wakeTarget(invocationId, driverAgentId) {
      const row = await deps.repo.get(invocationId);
      if (!row || row.driverAgentId !== driverAgentId)
        throw new RunError(`${invocationId} is not a sub-agent of yours`);
      if (row.reapedAt)
        throw new RunError(
          `${invocationId} was removed after its result; only a sub-agent spawned with keep stays to be entered`,
        );
      const agent = await deps.agents.get(invocationId);
      if (agent?.stopRequested)
        throw new RunError(
          `${invocationId}'s machine is being stopped after a run that could not be ended; try again in a minute`,
        );
      await deps.wakeAgent(invocationId);
    },

    async stopTarget(invocationId, driverAgentId, reason) {
      const row = await deps.repo.get(invocationId);
      if (!row || row.driverAgentId !== driverAgentId)
        throw new RunError(
          `${invocationId} is not a sub-agent you started. Pass the id that spawn_subagent returned; a run id from run_subagent is not one.`,
        );
      const kept = row.keepUntil && row.keepUntil.getTime() > now().getTime();
      if (kept && !reason) {
        if (!(await deps.stopper.running(row))) return { stopped: false };
        throw new RunError(
          `${invocationId} is kept, so stopping it takes a reason: its user reads it beside the stopped run`,
        );
      }
      return deps.stopper.stop(row, {
        reason: driverStopReason(reason),
        actor: driverAgentId,
        actorKind: "agent",
        collectTarget: true,
      });
    },

    async get(invocationId, driverAgentId) {
      const row = await deps.repo.find(invocationId);
      if (!row || row.driverAgentId !== driverAgentId) return null;
      const waiting =
        row.status === "running" && row.startedAt === null
          ? await deps.readStartWait?.(row.id).catch(() => null)
          : null;
      return {
        ...(row.runId && { run: row.runId }),
        ...(row.sessionId && { session: row.sessionId }),
        status: row.status,
        result: row.result,
        errorReason: row.errorReason ?? undefined,
        ...(row.exitCode !== null && { exitCode: row.exitCode }),
        ...(row.script !== null && { output: row.output ?? {} }),
        ...(waiting && { waiting }),
        ...(row.keepUntil && { keepUntil: row.keepUntil.toISOString() }),
        ...(row.reapedAt && { removed: true }),
      };
    },

    async extendKeep(invocationId, driverAgentId, change) {
      const row = await deps.repo.get(invocationId);
      if (!row || row.driverAgentId !== driverAgentId || row.reapedAt)
        throw new KeepError(`${invocationId} is not a sub-agent of yours`);
      if (!row.keepUntil)
        throw new KeepError(
          `${invocationId} was not spawned with keep, so it is removed after its result`,
        );
      let until = row.keepUntil;
      if (change.keepForMs !== undefined) {
        const at = keepUntil(
          now(),
          change.keepForMs,
          deps.keepMaxMs ?? DEFAULT_KEEP_MS,
        );
        if (!(at instanceof Date)) throw new KeepError(at.error);
        await deps.repo.setKeepUntil(invocationId, at);
        until = at;
      }
      if (change.idleTimeoutMin === undefined) return { keepUntil: until };
      const idleTimeoutMin = idleMinutes(change.idleTimeoutMin);
      await deps.agents.update({
        id: invocationId,
        hibernationTimeoutMin: idleTimeoutMin,
      });
      return { keepUntil: until, idleTimeoutMin };
    },

    async recordResult(invocationId, result, reporting) {
      const named = reporting?.run
        ? await deps.repo.getRun(reporting.run)
        : null;
      const row =
        named ??
        (await deps.repo
          .get(invocationId)
          .then((latest) =>
            !reporting?.run || latest?.runId === invocationId ? latest : null,
          ));
      if (!row || row.id !== invocationId || !row.runId) {
        return { ok: false, errors: "no invocation is active for this agent" };
      }
      if (row.status !== "running") {
        return {
          ok: false,
          errors: `this run is already ${row.status}, so its result is not taken; end your turn now`,
        };
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
          errors: await failSetup(
            invocationId,
            HARNESS_CONFIG_STEP,
            refusal,
            row.runId,
          ),
        };
      }
      const validate = compileSchema(row.resultSchema);
      const value = coerceResult(result, validate);
      if (!validate(value)) {
        return { ok: false, errors: ajv.errorsText(validate.errors) };
      }
      const stored = await deps.repo.complete(
        row.runId,
        value,
        reporting?.sessionId ?? null,
      );
      if (!stored) {
        return { ok: false, errors: "invocation is no longer running" };
      }
      deps.reportedReap.afterReport({ id: row.id, owner: row.owner });
      return { ok: true };
    },
  };
}
