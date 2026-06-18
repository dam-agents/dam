import type {
  Agent,
  AgentSpec,
  AgentSpecCR,
  AgentState,
  ChannelConfig,
  DriverFailure,
} from "api-server-api";
import type { KubeObject } from "./k8s.js";
import {
  GROUP,
  KIND_AGENT,
  LABEL_OWNER,
  LABEL_TEMPLATE_REF,
  LAST_ACTIVITY_KEY,
  READY_REASON_HIBERNATED,
  VERSION,
} from "./labels.js";

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
  }>;
}

/** The observed Agent, read off the custom resource. State is derived purely
 *  from the controller-published conditions: no desiredState, and
 *  the non-authoritative status phase is not consumed. */
export interface InfraAgent {
  id: string;
  name: string;
  templateId?: string;
  spec: AgentSpec;
  /** The authoritative Ready condition: Ready = AgentPodReady ∧
   *  GatewayPodReady. False until the controller publishes it. */
  ready: boolean;
  /** Intentionally scaled to zero — Ready=False with the Hibernated reason.
   *  Distinguishes a hibernated agent from one still starting. */
  hibernated: boolean;
  /** Last reconcile error, surfaced from the Reconciled condition. */
  error?: string;
  /** Abnormal pod-termination cause, from the AgentPodReady condition message. */
  podTerminationReason?: string;
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

  const ready = readyCondition(obj);
  return {
    id,
    name: spec.name,
    templateId: obj.metadata?.labels?.[LABEL_TEMPLATE_REF],
    spec,
    ready: ready?.status === "True",
    hibernated:
      ready?.status === "False" && ready.reason === READY_REASON_HIBERNATED,
    error,
    podTerminationReason: agentPodTerminationMessage(obj),
  };
}

export function assembleAgent(
  infra: InfraAgent,
  channels: ChannelConfig[],
  allowedUserEmails: string[],
  contributionFailures: DriverFailure[],
  preparingWorkspace = false,
): Agent {
  return {
    id: infra.id,
    name: infra.name,
    templateId: infra.templateId,
    spec: infra.spec,
    state: computeAgentState(infra, preparingWorkspace),
    error: infra.error,
    podTerminationReason: infra.podTerminationReason,
    contributionFailures,
    channels,
    allowedUserEmails,
  };
}

export function buildAgentObject(
  spec: Record<string, unknown>,
  owner: string,
  name: string,
  templateId?: string,
): AgentObject {
  const labels: Record<string, string> = { [LABEL_OWNER]: owner };
  if (templateId) labels[LABEL_TEMPLATE_REF] = templateId;

  return {
    apiVersion: SPEC_VERSION,
    kind: KIND_AGENT,
    metadata: {
      name,
      labels,
      annotations: { [LAST_ACTIVITY_KEY]: new Date().toISOString() },
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
