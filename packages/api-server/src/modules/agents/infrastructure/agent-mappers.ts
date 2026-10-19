import type { z } from "zod";
import {
  agentKindSchema,
  kitUpdatePendingSchema,
  seedStampSchema,
} from "api-server-api";

import {
  GATEWAY_FAILURE_REASONS,
  NODE_FAULT_REASONS,
  POD_FAILURE_REASONS,
} from "../domain/wake-failure.js";
import { type RuntimeFeatures } from "agent-runtime-api";
import type {
  WorkspaceFailure,
  OnboardingStep,
  Agent,
  AgentKind,
  AgentReclaim,
  AgentSpec,
  AgentSpecCR,
  AgentState,
  ChannelConfig,
  ContributionKind,
  DriverFailure,
  RuntimeMigration,
  TemplateUpdate,
  KitUpdatePending,
  SeedStamp,
} from "api-server-api";
import type { KubeObject } from "./k8s.js";
import {
  ANN_AGENT_KIND,
  ANN_KB_SHARE_ROOTS,
  ANN_KB_TEMPLATE,
  ANN_LIFETIME_MS,
  ANN_SWEEPABLE,
  GROUP,
  KIND_AGENT,
  LABEL_OWNER,
  LABEL_TEMPLATE_REF,
  ACTIVE_SESSION_KEY,
  INVOCATIONS_ACTIVE_KEY,
  LAST_ACTIVITY_KEY,
  RECLAIMED_AT_KEY,
  AGENT_POD_REASON_MACHINE_STOPPING,
  READY_REASON_HIBERNATED,
  READY_REASON_OVER_BUDGET,
  RUNTIME_MIGRATING_CONDITION,
  RUNTIME_MIGRATION_KEY,
  RUNTIME_MIGRATION_MESSAGE_KEY,
  RUNTIME_MIGRATION_SOURCE_KEY,
  RUNTIME_MIGRATION_TARGET_KEY,
  DISABLED_KEY,
  STOP_REQUESTED_KEY,
  STORAGE_MIGRATION_KEY,
  VERSION,
  ANN_STARTER_KIT,
  ANN_STARTER_KIT_ONBOARDED,
  ANN_STARTER_KIT_SEED,
  ANN_KIT_UPDATE_PENDING,
  ANN_KIT_UPDATE_SKIPPED,
  ANN_IMAGE_UPDATE_FROM,
  ANN_IMAGE_UPDATE_REFUSED,
} from "./labels.js";
import {
  type IdleTimeoutMinutes,
  resolveEffectiveHibernationTimeoutMin,
} from "../domain/spec-assembly.js";
import {
  runtimeMigrationHold,
  runtimeMigrationOf,
  runtimeMigrationRefusal,
  type RuntimeMigrationHold,
  type RuntimeMigrationContext,
} from "../domain/runtime-migration.js";

const SPEC_VERSION = `${GROUP}/${VERSION}`;

function jsonAnnotation<K extends string, T>(
  key: K,
  schema: z.ZodType<T>,
  raw: string | undefined,
): Partial<Record<K, T>> {
  if (!raw) return {};
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? ({ [key]: parsed.data } as Record<K, T>) : {};
  } catch {
    return {};
  }
}

export interface AgentObject extends KubeObject {
  spec?: Record<string, unknown>;
}

interface AgentStatusObject {
  conditions?: Array<{
    type?: string;
    status?: string;
    reason?: string;
    message?: string;
    lastTransitionTime?: string;
    observedGeneration?: number;
  }>;
  agentPodRestarts?: number;
  agentPodRestartReason?: string;
  runtimeMigrationAttempts?: number;
}

export interface InfraAgent {
  id: string;
  name: string;
  createdAt?: string;
  resourceVersion?: string;
  templateId?: string;
  owner?: string;
  spec: AgentSpec;
  sweepable: boolean;
  lifetimeMs: number;
  kind?: AgentKind;
  kbTemplateId?: string;
  kbShareRoots?: string[];
  starterKit?: string;
  starterKitOnboarded?: string;
  starterKitSeed?: SeedStamp;
  kitUpdatePending?: KitUpdatePending;
  kitUpdateSkipped?: string;
  imageUpdateFrom?: string;
  imageUpdateRefused?: string;
  specStart?: "ready" | "failed";
  readySince?: Date;
  hibernatedSince?: Date;
  wakeRequested?: boolean;
  reclaimed?: AgentReclaim;
  quietSince?: Date;
  ready: boolean;
  hibernated: boolean;
  stopRequested: boolean;
  disabled: boolean;
  runtimeMigration?: RuntimeMigration;
  runtimeMigrationHold?: RuntimeMigrationHold;
  runtimeMigrationTarget?: string;
  storageMigrating?: boolean;
  overBudget: boolean;
  overBudgetMessage?: string;
  error?: string;
  reconciledReason?: string;
  podTerminationReason?: string;
  podTerminationCode?: string;
  notReadyMessage?: string;
  podRestarts: number;
  podRestartReason?: string;
  agentPodNotReadyReason?: string;
  agentPodReady?: boolean;
  gatewayPodReady?: boolean;
  gatewayPodNotReadyReason?: string;
  gatewayFailure?: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the start failures only a new image causes: it cannot be pulled or unpacked, or the machine cannot boot it. A full home volume, memory and runner placement fail on any image. A container exit on AgentPodReady is left out: that condition does not say which pod exited, and the pod a roll replaces exits on SIGTERM at the new generation. The controller's StartFailed condition says it of the current pod or machine instead.
// UNIT_BOUNDARY_DESCRIPTION: besides those, a machine's start is also a failed start when the node it runs on cannot serve it, which NODE_FAULT_REASONS names. That case is still a failed start of this spec, so the Agent reads as one, but the image is not what failed: the image update job holds the upgrade on it instead of moving the Agent back.
const IMAGE_START_FAILURES = new Set([
  "ImagePullFailure",
  "InvalidImageName",
  "MachineBootFailed",
  "MachineImageUnavailable",
]);

const TERMINAL_MACHINE_REASONS = new Set(
  [...POD_FAILURE_REASONS].filter((r) => r.startsWith("Machine")),
);

export function computeAgentState(
  infra: InfraAgent,
  preparingWorkspace = false,
): AgentState {
  if (infra.error) return "error";
  if ((infra.runtimeMigrationHold ?? "none") !== "none") return "migrating";
  if (infra.ready)
    return preparingWorkspace ? "preparing_workspace" : "running";
  if (infra.hibernated) return "hibernated";
  if (infra.overBudget) return "over_budget";
  if (infra.agentPodNotReadyReason === AGENT_POD_REASON_MACHINE_STOPPING)
    return "hibernating";
  if (infra.agentPodReady === true && infra.gatewayPodReady === false)
    return preparingWorkspace ? "preparing_workspace" : "running";
  if (
    infra.agentPodNotReadyReason &&
    TERMINAL_MACHINE_REASONS.has(infra.agentPodNotReadyReason)
  )
    return "error";
  return "starting";
}

export function readyConditionStatus(
  obj: KubeObject,
): "True" | "False" | undefined {
  const ready = readyCondition(obj);
  if (ready?.status === "True") return "True";
  if (ready?.status === "False") return "False";
  return undefined;
}

function readyCondition(obj: KubeObject) {
  const status = (obj.status ?? {}) as AgentStatusObject;
  return status.conditions?.find((c) => c.type === "Ready");
}

export function agentOwner(obj: KubeObject): string | undefined {
  return obj.metadata?.labels?.[LABEL_OWNER];
}

export function agentIsOwnedBy(obj: KubeObject, owner: string): boolean {
  return agentOwner(obj) === owner;
}

function createdAtOf(obj: KubeObject): string | undefined {
  const raw = (
    obj.metadata as { creationTimestamp?: Date | string } | undefined
  )?.creationTimestamp;
  if (!raw) return undefined;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function validDate(raw: string | undefined): Date | undefined {
  const d = raw ? new Date(raw) : undefined;
  return d && !Number.isNaN(d.getTime()) ? d : undefined;
}

export function parseInfraAgent(obj: KubeObject): InfraAgent {
  const id = obj.metadata?.name ?? "";
  const crSpec = (obj.spec ?? {}) as AgentSpecCR;
  const spec: AgentSpec = { ...crSpec, name: crSpec.name ?? id };

  const status = (obj.status ?? {}) as AgentStatusObject;
  const reconciled = status.conditions?.find((c) => c.type === "Reconciled");
  const error =
    reconciled?.status === "False"
      ? reconciled.message || undefined
      : undefined;

  const agentPod = status.conditions?.find((c) => c.type === "AgentPodReady");
  const restarts = status.agentPodRestarts;
  const gatewayPod = status.conditions?.find(
    (c) => c.type === "GatewayPodReady",
  );

  const ready = readyCondition(obj);
  const hibernated =
    ready?.status === "False" && ready.reason === READY_REASON_HIBERNATED;
  const annotations = obj.metadata?.annotations ?? {};
  const kbShareRoots = splitRoots(annotations[ANN_KB_SHARE_ROOTS]);
  const lifetimeMs = Number.parseInt(annotations[ANN_LIFETIME_MS] ?? "", 10);
  const kindParse = agentKindSchema.safeParse(annotations[ANN_AGENT_KIND]);
  const hibernatedSince = hibernated
    ? validDate(ready?.lastTransitionTime)
    : undefined;
  const reclaimedAt = hibernated
    ? validDate(annotations[RECLAIMED_AT_KEY])
    : undefined;
  const reclaimed: AgentReclaim | undefined =
    reclaimedAt &&
    (validDate(annotations[LAST_ACTIVITY_KEY])?.getTime() ?? 0) <=
      reclaimedAt.getTime()
      ? {
          at: reclaimedAt.toISOString(),
          for: crSpec.backend?.type === "vm" ? "memory" : "compute",
        }
      : undefined;
  const createdAt = createdAtOf(obj);
  const migrating = status.conditions?.find(
    (c) => c.type === RUNTIME_MIGRATING_CONDITION,
  );
  const runtimeMigration = runtimeMigrationOf({
    requested: annotations[RUNTIME_MIGRATION_KEY],
    legacyMessage: annotations[RUNTIME_MIGRATION_MESSAGE_KEY],
    ...(migrating ? { condition: migrating } : {}),
    attempts: status.runtimeMigrationAttempts,
    vm: crSpec.backend?.type === "vm",
  });
  const resourceVersion = obj.metadata?.resourceVersion;
  const generation = obj.metadata?.generation;
  const startFailed = status.conditions?.find((c) => c.type === "StartFailed");
  const specStart =
    generation === undefined
      ? undefined
      : (startFailed?.status === "True" &&
            startFailed.observedGeneration === generation) ||
          (agentPod?.status === "False" &&
            agentPod.observedGeneration === generation &&
            (IMAGE_START_FAILURES.has(agentPod.reason ?? "") ||
              NODE_FAULT_REASONS.has(agentPod.reason ?? "")))
        ? "failed"
        : ready?.status === "True" && ready.observedGeneration === generation
          ? "ready"
          : undefined;
  const readySince =
    ready?.status === "True" ? validDate(ready.lastTransitionTime) : undefined;
  const quietSince =
    annotations[ACTIVE_SESSION_KEY] === "true" ||
    annotations[INVOCATIONS_ACTIVE_KEY] === "true"
      ? undefined
      : validDate(annotations[LAST_ACTIVITY_KEY]);
  return {
    id,
    name: spec.name,
    ...(createdAt ? { createdAt } : {}),
    ...(resourceVersion ? { resourceVersion } : {}),
    templateId: obj.metadata?.labels?.[LABEL_TEMPLATE_REF],
    owner: agentOwner(obj),
    spec,
    sweepable: annotations[ANN_SWEEPABLE] === "true",
    lifetimeMs: Number.isFinite(lifetimeMs) && lifetimeMs > 0 ? lifetimeMs : 0,
    ...(kindParse.success ? { kind: kindParse.data } : {}),
    ...(annotations[ANN_KB_TEMPLATE]
      ? { kbTemplateId: annotations[ANN_KB_TEMPLATE] }
      : {}),
    ...(kbShareRoots ? { kbShareRoots } : {}),
    ...(annotations[ANN_STARTER_KIT_ONBOARDED]
      ? { starterKitOnboarded: annotations[ANN_STARTER_KIT_ONBOARDED] }
      : {}),
    ...(annotations[ANN_STARTER_KIT]
      ? { starterKit: annotations[ANN_STARTER_KIT] }
      : {}),
    ...jsonAnnotation(
      "starterKitSeed",
      seedStampSchema,
      annotations[ANN_STARTER_KIT_SEED],
    ),
    ...jsonAnnotation(
      "kitUpdatePending",
      kitUpdatePendingSchema,
      annotations[ANN_KIT_UPDATE_PENDING],
    ),
    ...(annotations[ANN_KIT_UPDATE_SKIPPED]
      ? { kitUpdateSkipped: annotations[ANN_KIT_UPDATE_SKIPPED] }
      : {}),
    ...(annotations[ANN_IMAGE_UPDATE_FROM]
      ? { imageUpdateFrom: annotations[ANN_IMAGE_UPDATE_FROM] }
      : {}),
    ...(annotations[ANN_IMAGE_UPDATE_REFUSED]
      ? { imageUpdateRefused: annotations[ANN_IMAGE_UPDATE_REFUSED] }
      : {}),
    ...(specStart ? { specStart } : {}),
    ...(readySince ? { readySince } : {}),
    ...(hibernatedSince ? { hibernatedSince } : {}),
    ...(hibernatedSince &&
      (validDate(annotations[LAST_ACTIVITY_KEY])?.getTime() ?? 0) >
        hibernatedSince.getTime() && { wakeRequested: true }),
    ...(quietSince ? { quietSince } : {}),
    ...(reclaimed ? { reclaimed } : {}),
    ready: ready?.status === "True",
    hibernated,
    stopRequested: !!annotations[STOP_REQUESTED_KEY],
    disabled: !!annotations[DISABLED_KEY],
    ...(runtimeMigration ? { runtimeMigration } : {}),
    runtimeMigrationHold: runtimeMigrationHold(
      runtimeMigration,
      !!annotations[RUNTIME_MIGRATION_SOURCE_KEY],
    ),
    ...(annotations[RUNTIME_MIGRATION_TARGET_KEY]
      ? { runtimeMigrationTarget: annotations[RUNTIME_MIGRATION_TARGET_KEY] }
      : {}),
    storageMigrating: !!annotations[STORAGE_MIGRATION_KEY],
    overBudget:
      ready?.status === "False" && ready.reason === READY_REASON_OVER_BUDGET,
    overBudgetMessage:
      ready?.status === "False" && ready.reason === READY_REASON_OVER_BUDGET
        ? ready.message || undefined
        : undefined,
    error,
    reconciledReason:
      reconciled?.status === "False" ? reconciled.reason : undefined,
    podTerminationReason:
      agentPod?.status === "False" &&
      agentPod.message &&
      agentPod.reason &&
      POD_FAILURE_REASONS.has(agentPod.reason)
        ? agentPod.message
        : undefined,
    podTerminationCode:
      agentPod?.status === "False" &&
      agentPod.reason &&
      POD_FAILURE_REASONS.has(agentPod.reason)
        ? agentPod.reason
        : undefined,
    notReadyMessage:
      agentPod?.status === "False" &&
      agentPod.message &&
      !POD_FAILURE_REASONS.has(agentPod.reason ?? "")
        ? agentPod.message
        : undefined,
    podRestarts:
      typeof restarts === "number" && Number.isFinite(restarts) && restarts > 0
        ? restarts
        : 0,
    podRestartReason: status.agentPodRestartReason || undefined,
    agentPodNotReadyReason:
      agentPod?.status === "False" ? agentPod.reason : undefined,
    agentPodReady: agentPod ? agentPod.status === "True" : undefined,
    gatewayPodReady: gatewayPod ? gatewayPod.status === "True" : undefined,
    gatewayPodNotReadyReason:
      gatewayPod?.status === "False" ? gatewayPod.reason : undefined,
    gatewayFailure:
      !hibernated &&
      ready?.reason !== READY_REASON_OVER_BUDGET &&
      gatewayPod?.status === "False" &&
      GATEWAY_FAILURE_REASONS.has(gatewayPod.reason ?? "")
        ? gatewayPod.message || gatewayPod.reason
        : undefined,
  };
}

export function assembleAgent(
  infra: InfraAgent,
  channels: ChannelConfig[],
  contributionFailures: DriverFailure[],
  idleTimeoutMinutes: IdleTimeoutMinutes,
  preparingWorkspace: boolean,
  templateUpdate: TemplateUpdate | undefined,
  features: RuntimeFeatures,
  unsupportedContributionKinds: ContributionKind[],
  workspaceFailures: WorkspaceFailure[],
  runtimeMigrationContext: RuntimeMigrationContext,
  onboardingSteps?: OnboardingStep[],
): Agent {
  return {
    id: infra.id,
    name: infra.name,
    ...(infra.createdAt ? { createdAt: infra.createdAt } : {}),
    templateId: infra.templateId,
    templateUpdate,
    ...(infra.runtimeMigration
      ? { runtimeMigration: infra.runtimeMigration }
      : {}),
    runtimeMigratable:
      runtimeMigrationRefusal(infra, runtimeMigrationContext) === null,
    spec: infra.spec,
    state: computeAgentState(infra, preparingWorkspace),
    effectiveHibernationTimeoutMin: resolveEffectiveHibernationTimeoutMin(
      infra.spec.hibernationTimeout,
      infra.spec.backend?.type === "vm",
      idleTimeoutMinutes,
    ),
    error: infra.error,
    stopRequested: infra.stopRequested,
    disabled: infra.disabled,
    overBudget: infra.overBudget,
    overBudgetMessage: infra.overBudgetMessage,
    ...(infra.reclaimed ? { reclaimed: infra.reclaimed } : {}),
    podTerminationReason: infra.podTerminationReason,
    podTerminationCode: infra.podTerminationCode,
    notReadyMessage: infra.notReadyMessage,
    podRestarts: infra.podRestarts,
    podRestartReason: infra.podRestartReason,
    gatewayFailure: infra.gatewayFailure,
    contributionFailures,
    unsupportedContributionKinds,
    workspaceFailures,
    channels,
    kind: infra.kind,
    kbTemplateId: infra.kbTemplateId,
    kbShareRoots: infra.kbShareRoots,
    starterKit: infra.starterKit,
    starterKitOnboarded: infra.starterKitOnboarded,
    starterKitSeed: infra.starterKitSeed,
    kitUpdatePending: infra.kitUpdatePending,
    kitUpdateSkipped: infra.kitUpdateSkipped,
    ...(onboardingSteps ? { onboardingSteps } : {}),
    features,
  };
}

export function buildAgentObject(
  spec: Record<string, unknown>,
  owner: string,
  name: string,
  templateId?: string,
  annotations?: Record<string, string>,
): AgentObject {
  const labels: Record<string, string> = { [LABEL_OWNER]: owner };
  if (templateId) labels[LABEL_TEMPLATE_REF] = templateId;

  return {
    apiVersion: SPEC_VERSION,
    kind: KIND_AGENT,
    metadata: {
      name,
      labels,
      annotations: {
        [LAST_ACTIVITY_KEY]: new Date().toISOString(),
        ...annotations,
      },
    },
    spec,
  };
}

function splitRoots(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const roots = raw
    .split(",")
    .map((root) => root.trim())
    .filter((root) => root.length > 0);
  return roots.length > 0 ? roots : undefined;
}
