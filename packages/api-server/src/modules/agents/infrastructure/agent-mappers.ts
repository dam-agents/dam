import { agentKindSchema } from "api-server-api";
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
  VERSION,
} from "./labels.js";
import { resolveEffectiveHibernationTimeoutMin } from "../domain/spec-assembly.js";

const SPEC_VERSION = `${GROUP}/${VERSION}`;

/** The agent-platform.ai/v1 Agent custom resource. The api-server
 *  writes spec + grant fields; the controller owns the status subresource. */
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
}

/** The observed Agent, read off the custom resource. State is derived purely
 *  from the controller-published conditions: no desiredState, and
 *  the non-authoritative status phase is not consumed. */
export interface InfraAgent {
  id: string;
  name: string;
  templateId?: string;
  /** The agent's owner (LABEL_OWNER). Needed by owner-agnostic scans (the
   *  Agent Sweep) that must resolve an owner-scoped service to delete. */
  owner?: string;
  spec: AgentSpec;
  /** Sweepable (#2816): the Agent Sweep deletes this agent once it hibernates
   *  (after its Lifetime grace, if any). Ephemeral agents only. */
  sweepable: boolean;
  /** Agent Lifetime grace in ms (0 = delete as soon as it hibernates). Only
   *  meaningful when `sweepable`. */
  lifetimeMs: number;
  /** Agent Kind (#2946): which first-class surface owns this agent
   *  (knowledge-base). Absent on plain sandboxes. */
  kind?: AgentKind;
  /** The KB template a Knowledge Base was created from. Opaque here — the
   *  knowledge-bases surface owns the id set. Absent on plain sandboxes. */
  kbTemplateId?: string;
  /** When the agent transitioned into hibernation (Ready condition's
   *  lastTransitionTime while hibernated), else undefined. The Sweep bases the
   *  Lifetime grace on this. */
  hibernatedSince?: Date;
  /** The authoritative Ready condition: Ready = AgentPodReady ∧
   *  GatewayPodReady. False until the controller publishes it. */
  ready: boolean;
  /** Intentionally scaled to zero — Ready=False with the Hibernated reason.
   *  Distinguishes a hibernated agent from one still starting. */
  hibernated: boolean;
  /** Parked (#1900) — Ready=False with the OverBudget reason: the agent
   *  wants to run but starting it would breach its owner's Ceiling. */
  overBudget: boolean;
  /** The controller's reserved/ceiling figures for a parked agent —
   *  user-facing copy (quantities only, no resource names). */
  overBudgetMessage?: string;
  /** Last reconcile error, surfaced from the Reconciled condition. */
  error?: string;
  /** Reconciled condition reason when False (ReconcileError |
   *  BackoffLimitExceeded). */
  reconciledReason?: string;
  /** Abnormal pod-termination cause, from the AgentPodReady condition message. */
  podTerminationReason?: string;
  /** AgentPodReady condition reason token when False (PodNotReady, or a
   *  termination token like ImagePullFailure / OutOfMemory). */
  agentPodNotReadyReason?: string;
  /** AgentPodReady condition is True. Undefined until published. */
  agentPodReady?: boolean;
  /** GatewayPodReady condition is True. Undefined until published. */
  gatewayPodReady?: boolean;
  /** GatewayPodReady reason when False (PodNotReady, or a hard cause like
   *  StuckOnSupersededRevision / OutOfMemory) — #2817. */
  gatewayPodNotReadyReason?: string;
}

/** Map the controller's conditions to the public-facing AgentState. Mostly
 *  condition-driven; `preparingWorkspace` (a pending workspace-seed
 *  clone) refines a Ready agent into the not-yet-usable phase. */
export function computeAgentState(
  infra: InfraAgent,
  preparingWorkspace = false,
): AgentState {
  if (infra.error) return "error";
  if (infra.ready)
    return preparingWorkspace ? "preparing_workspace" : "running";
  if (infra.hibernated) return "hibernated";
  // Parked (#1900) before the "starting" fallthrough: a parked agent is not
  // coming up — presenting it as perpetually starting would mislead pollers.
  if (infra.overBudget) return "over_budget";
  // Gateway-only unreadiness (#2903): the agent pod is up and serving — a
  // gateway roll (credential / L7-chain change) must not present as an agent
  // restart. Presentation only: routing (ensureReady) still waits on the
  // aggregate Ready.
  if (infra.agentPodReady === true && infra.gatewayPodReady === false)
    return preparingWorkspace ? "preparing_workspace" : "running";
  return "starting";
}

/** The status of the controller-published `Ready` condition, or
 *  undefined when the controller has not published it yet (mid-create /
 *  pre-first-reconcile). Absent or False means not ready — there is no probe. */
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

/** The abnormal-termination cause the controller stamps on AgentPodReady, else undefined. */
function agentPodTerminationMessage(obj: KubeObject): string | undefined {
  const status = (obj.status ?? {}) as AgentStatusObject;
  const c = status.conditions?.find((c) => c.type === "AgentPodReady");
  return c?.status === "False" && c.message ? c.message : undefined;
}

export function agentOwner(obj: KubeObject): string | undefined {
  return obj.metadata?.labels?.[LABEL_OWNER];
}

export function agentIsOwnedBy(obj: KubeObject, owner: string): boolean {
  return agentOwner(obj) === owner;
}

export function parseInfraAgent(obj: KubeObject): InfraAgent {
  const id = obj.metadata?.name ?? "";
  // obj.spec is the generated AgentSpecCR (K8s validated it at admission)
  // and is the public spec as-is — the grants are api-server-written
  // intent, not controller status, so they stay. Only guarantee name (the CR
  // marks it optional; fall back to the resource id).
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
  // Unknown kind values (a newer writer) degrade to a plain sandbox rather
  // than failing the whole list read.
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
  preparingWorkspace = false,
  templateUpdate?: TemplateUpdate,
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
    overBudget: infra.overBudget,
    overBudgetMessage: infra.overBudgetMessage,
    podTerminationReason: infra.podTerminationReason,
    contributionFailures,
    channels,
    kind: infra.kind,
    kbTemplateId: infra.kbTemplateId,
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
