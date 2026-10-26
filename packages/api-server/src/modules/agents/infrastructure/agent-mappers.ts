import type { z } from "zod";
import {
  agentKindSchema,
  kitUpdatePendingSchema,
  seedStampSchema,
} from "api-server-api";

import {
  GATEWAY_FAILURE_REASONS,
  NODE_FAULT_REASONS,
  MACHINE_FAILURE_REASONS,
} from "../domain/wake-failure.js";
import { type RuntimeFeatures } from "agent-runtime-api";
import type {
  WorkspaceFailure,
  OnboardingStep,
  Agent,
  AgentKind,
  AgentNesting,
  AgentReclaim,
  AgentSpec,
  AgentSpecCR,
  AgentStartFailure,
  AgentState,
  ChannelConfig,
  ContributionKind,
  DriverFailure,
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
  MACHINE_STOPPING_REASON,
  READY_REASON_HIBERNATED,
  READY_REASON_OVER_BUDGET,
  DISABLED_KEY,
  STOP_REQUESTED_KEY,
  VERSION,
  ANN_STARTER_KIT,
  ANN_STARTER_KIT_ONBOARDED,
  ANN_STARTER_KIT_SEED,
  ANN_STARTER_KIT_DEFAULT_MODEL,
  ANN_KIT_UPDATE_PENDING,
  ANN_KIT_UPDATE_SKIPPED,
  ANN_IMAGE_UPDATE_FROM,
  ANN_IMAGE_UPDATE_REFUSED,
} from "./labels.js";
import { resolveEffectiveHibernationTimeoutMin } from "../domain/spec-assembly.js";

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
  signalVersion?: number;
  statusVersion?: number;
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
  starterKitDefaultModel?: string;
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
  overBudget: boolean;
  overBudgetMessage?: string;
  error?: string;
  reconciledReason?: string;
  podTerminationReason?: string;
  podTerminationCode?: string;
  notReadyMessage?: string;
  startFailure?: AgentStartFailure;
  nesting?: AgentNesting;
  podRestarts: number;
  podRestartReason?: string;
  signalVersion?: number;
  statusVersion?: number;
  machineNotReadyReason?: string;
  machineReady?: boolean;
  gatewayPodReady?: boolean;
  gatewayPodNotReadyReason?: string;
  gatewayFailure?: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the start failures only a new image causes: it cannot be pulled or unpacked, or the machine cannot boot it. A full home volume, memory and runner placement fail on any image. A container exit on AgentPodReady is left out: that condition does not say which workload exited, and the workload a roll replaces exits on SIGTERM at the new generation. The controller's StartFailed condition says it of the current pod or machine instead.
// UNIT_BOUNDARY_DESCRIPTION: besides those, a machine's start is also a failed start when the node it runs on cannot serve it, which NODE_FAULT_REASONS names. That case is still a failed start of this spec, so the Agent reads as one, but the image is not what failed: the image update job holds the upgrade on it instead of moving the Agent back.
const IMAGE_START_FAILURES = new Set([
  "ImagePullFailure",
  "InvalidImageName",
  "MachineBootFailed",
  "MachineImageUnavailable",
]);

const TERMINAL_MACHINE_REASONS = new Set(
  [...MACHINE_FAILURE_REASONS].filter((r) => r.startsWith("Machine")),
);

export function computeAgentState(
  infra: InfraAgent,
  preparingWorkspace = false,
): AgentState {
  if (infra.error) return "error";
  if (infra.ready)
    return preparingWorkspace ? "preparing_workspace" : "running";
  if (infra.hibernated) return "hibernated";
  if (infra.overBudget) return "over_budget";
  if (infra.machineNotReadyReason === MACHINE_STOPPING_REASON)
    return "hibernating";
  if (infra.machineReady === true && infra.gatewayPodReady === false)
    return preparingWorkspace ? "preparing_workspace" : "running";
  if (
    infra.machineNotReadyReason &&
    TERMINAL_MACHINE_REASONS.has(infra.machineNotReadyReason)
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

  const machineCond = status.conditions?.find(
    (c) => c.type === "AgentPodReady",
  );
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
          for: "memory",
        }
      : undefined;
  const createdAt = createdAtOf(obj);
  const resourceVersion = obj.metadata?.resourceVersion;
  const generation = obj.metadata?.generation;
  const startFailed = status.conditions?.find((c) => c.type === "StartFailed");
  const nested = status.conditions?.find(
    (c) => c.type === "NestedVirtualization",
  );
  const specStart =
    generation === undefined
      ? undefined
      : (startFailed?.status === "True" &&
            startFailed.observedGeneration === generation) ||
          (machineCond?.status === "False" &&
            machineCond.observedGeneration === generation &&
            (IMAGE_START_FAILURES.has(machineCond.reason ?? "") ||
              NODE_FAULT_REASONS.has(machineCond.reason ?? "")))
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
    ...(annotations[ANN_STARTER_KIT_DEFAULT_MODEL]
      ? {
          starterKitDefaultModel: annotations[ANN_STARTER_KIT_DEFAULT_MODEL],
        }
      : {}),
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
      machineCond?.status === "False" &&
      machineCond.message &&
      machineCond.reason &&
      MACHINE_FAILURE_REASONS.has(machineCond.reason)
        ? machineCond.message
        : undefined,
    podTerminationCode:
      machineCond?.status === "False" &&
      machineCond.reason &&
      MACHINE_FAILURE_REASONS.has(machineCond.reason)
        ? machineCond.reason
        : undefined,
    notReadyMessage:
      machineCond?.status === "False" &&
      machineCond.message &&
      !MACHINE_FAILURE_REASONS.has(machineCond.reason ?? "")
        ? machineCond.message
        : undefined,
    startFailure:
      startFailed?.status === "True" &&
      generation !== undefined &&
      startFailed.observedGeneration === generation &&
      startFailed.reason &&
      startFailed.message
        ? { reason: startFailed.reason, message: startFailed.message }
        : undefined,
    ...(nested && {
      nesting: {
        enabled: nested.status === "True",
        reason: nested.reason ?? "",
        message: nested.message ?? "",
      },
    }),
    podRestarts:
      typeof restarts === "number" && Number.isFinite(restarts) && restarts > 0
        ? restarts
        : 0,
    ...(typeof status.signalVersion === "number" && {
      signalVersion: status.signalVersion,
    }),
    ...(typeof status.statusVersion === "number" && {
      statusVersion: status.statusVersion,
    }),
    podRestartReason: status.agentPodRestartReason || undefined,
    machineNotReadyReason:
      machineCond?.status === "False" ? machineCond.reason : undefined,
    machineReady: machineCond ? machineCond.status === "True" : undefined,
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
  idleTimeoutMinutes: number,
  preparingWorkspace: boolean,
  templateUpdate: TemplateUpdate | undefined,
  features: RuntimeFeatures,
  unsupportedContributionKinds: ContributionKind[],
  workspaceFailures: WorkspaceFailure[],
  onboardingSteps?: OnboardingStep[],
): Agent {
  return {
    id: infra.id,
    name: infra.name,
    ...(infra.createdAt ? { createdAt: infra.createdAt } : {}),
    templateId: infra.templateId,
    templateUpdate,
    spec: infra.spec,
    state: computeAgentState(infra, preparingWorkspace),
    effectiveHibernationTimeoutMin: resolveEffectiveHibernationTimeoutMin(
      infra.spec.hibernationTimeout,
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
    ...(infra.startFailure ? { startFailure: infra.startFailure } : {}),
    ...(infra.nesting ? { nesting: infra.nesting } : {}),
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
    ...(infra.starterKitDefaultModel
      ? { starterKitDefaultModel: infra.starterKitDefaultModel }
      : {}),
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
