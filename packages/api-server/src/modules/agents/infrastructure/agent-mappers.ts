import { agentKindSchema } from "api-server-api";
import { type RuntimeFeatures } from "agent-runtime-api";
import type {
  Agent,
  AgentKind,
  AgentSpec,
  AgentSpecCR,
  AgentState,
  ChannelConfig,
  DriverFailure,
  TemplateUpdate,
} from "api-server-api";
import type { KubeObject } from "./k8s.js";
import {
  ANN_AGENT_KIND,
  ANN_KB_TEMPLATE,
  ANN_LIFETIME_MS,
  ANN_SWEEPABLE,
  GROUP,
  KIND_AGENT,
  LABEL_OWNER,
  LABEL_TEMPLATE_REF,
  LAST_ACTIVITY_KEY,
  READY_REASON_HIBERNATED,
  READY_REASON_OVER_BUDGET,
  STOP_REQUESTED_KEY,
  VERSION,
} from "./labels.js";
import { resolveEffectiveHibernationTimeoutMin } from "../domain/spec-assembly.js";

const SPEC_VERSION = `${GROUP}/${VERSION}`;

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
  }>;
  agentPodRestarts?: number;
  agentPodRestartReason?: string;
}

export interface InfraAgent {
  id: string;
  name: string;
  templateId?: string;
  owner?: string;
  spec: AgentSpec;
  sweepable: boolean;
  lifetimeMs: number;
  kind?: AgentKind;
  kbTemplateId?: string;
  hibernatedSince?: Date;
  ready: boolean;
  hibernated: boolean;
  stopRequested: boolean;
  overBudget: boolean;
  overBudgetMessage?: string;
  error?: string;
  reconciledReason?: string;
  podTerminationReason?: string;
  podRestarts: number;
  podRestartReason?: string;
  agentPodNotReadyReason?: string;
  agentPodReady?: boolean;
  gatewayPodReady?: boolean;
  gatewayPodNotReadyReason?: string;
}

export function computeAgentState(
  infra: InfraAgent,
  preparingWorkspace = false,
): AgentState {
  if (infra.error) return "error";
  if (infra.ready)
    return preparingWorkspace ? "preparing_workspace" : "running";
  if (infra.hibernated) return "hibernated";
  if (infra.overBudget) return "over_budget";
  if (infra.agentPodReady === true && infra.gatewayPodReady === false)
    return preparingWorkspace ? "preparing_workspace" : "running";
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

function agentPodTerminationMessage(obj: KubeObject): string | undefined {
  const status = (obj.status ?? {}) as AgentStatusObject;
  const c = status.conditions?.find((c) => c.type === "AgentPodReady");
  return c?.status === "False" && c.message ? c.message : undefined;
}

function agentPodRestarts(obj: KubeObject): number {
  const status = (obj.status ?? {}) as AgentStatusObject;
  const restarts = status.agentPodRestarts;
  return typeof restarts === "number" &&
    Number.isFinite(restarts) &&
    restarts > 0
    ? restarts
    : 0;
}

function agentPodRestartReason(obj: KubeObject): string | undefined {
  const status = (obj.status ?? {}) as AgentStatusObject;
  return status.agentPodRestartReason || undefined;
}

export function agentOwner(obj: KubeObject): string | undefined {
  return obj.metadata?.labels?.[LABEL_OWNER];
}

export function agentIsOwnedBy(obj: KubeObject, owner: string): boolean {
  return agentOwner(obj) === owner;
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
  const gatewayPod = status.conditions?.find(
    (c) => c.type === "GatewayPodReady",
  );

  const ready = readyCondition(obj);
  const hibernated =
    ready?.status === "False" && ready.reason === READY_REASON_HIBERNATED;
  const annotations = obj.metadata?.annotations ?? {};
  const lifetimeMs = Number.parseInt(annotations[ANN_LIFETIME_MS] ?? "", 10);
  const kindParse = agentKindSchema.safeParse(annotations[ANN_AGENT_KIND]);
  const hibernatedSince =
    hibernated && ready?.lastTransitionTime
      ? new Date(ready.lastTransitionTime)
      : undefined;
  return {
    id,
    name: spec.name,
    templateId: obj.metadata?.labels?.[LABEL_TEMPLATE_REF],
    owner: agentOwner(obj),
    spec,
    sweepable: annotations[ANN_SWEEPABLE] === "true",
    lifetimeMs: Number.isFinite(lifetimeMs) && lifetimeMs > 0 ? lifetimeMs : 0,
    ...(kindParse.success ? { kind: kindParse.data } : {}),
    ...(annotations[ANN_KB_TEMPLATE]
      ? { kbTemplateId: annotations[ANN_KB_TEMPLATE] }
      : {}),
    ...(hibernatedSince ? { hibernatedSince } : {}),
    ready: ready?.status === "True",
    hibernated,
    stopRequested: !!annotations[STOP_REQUESTED_KEY],
    overBudget:
      ready?.status === "False" && ready.reason === READY_REASON_OVER_BUDGET,
    overBudgetMessage:
      ready?.status === "False" && ready.reason === READY_REASON_OVER_BUDGET
        ? ready.message || undefined
        : undefined,
    error,
    reconciledReason:
      reconciled?.status === "False" ? reconciled.reason : undefined,
    podTerminationReason: agentPodTerminationMessage(obj),
    podRestarts: agentPodRestarts(obj),
    podRestartReason: agentPodRestartReason(obj),
    agentPodNotReadyReason:
      agentPod?.status === "False" ? agentPod.reason : undefined,
    agentPodReady: agentPod ? agentPod.status === "True" : undefined,
    gatewayPodReady: gatewayPod ? gatewayPod.status === "True" : undefined,
    gatewayPodNotReadyReason:
      gatewayPod?.status === "False" ? gatewayPod.reason : undefined,
  };
}

export function assembleAgent(
  infra: InfraAgent,
  channels: ChannelConfig[],
  contributionFailures: DriverFailure[],
  globalIdleTimeoutMin: number,
  preparingWorkspace: boolean,
  templateUpdate: TemplateUpdate | undefined,
  features: RuntimeFeatures,
): Agent {
  return {
    id: infra.id,
    name: infra.name,
    templateId: infra.templateId,
    templateUpdate,
    spec: infra.spec,
    state: computeAgentState(infra, preparingWorkspace),
    effectiveHibernationTimeoutMin: resolveEffectiveHibernationTimeoutMin(
      infra.spec.hibernationTimeout,
      globalIdleTimeoutMin,
    ),
    error: infra.error,
    stopRequested: infra.stopRequested,
    overBudget: infra.overBudget,
    overBudgetMessage: infra.overBudgetMessage,
    podTerminationReason: infra.podTerminationReason,
    contributionFailures,
    channels,
    kind: infra.kind,
    kbTemplateId: infra.kbTemplateId,
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

export function findOrphanedAgentIds(
  infraIds: Set<string>,
  psqlAgentIds: string[],
): string[] {
  return psqlAgentIds.filter((id) => !infraIds.has(id));
}
