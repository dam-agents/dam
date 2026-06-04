import type {
  Agent,
  AgentSpec,
  AgentSpecCR,
  AgentState,
  ChannelConfig,
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
import { generateK8sName } from "./configmap-mappers.js";

const SPEC_VERSION = `${GROUP}/${VERSION}`;

/** The agent-platform.ai/v1 Agent custom resource (ADR-058). The api-server
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
 *  from the controller-published conditions (ADR-058/059): no desiredState, and
 *  the non-authoritative status phase is not consumed. */
export interface InfraAgent {
  id: string;
  name: string;
  templateId?: string;
  spec: AgentSpec;
  /** The authoritative Ready condition (ADR-059): Ready = AgentPodReady ∧
   *  GatewayPodReady. False until the controller publishes it. */
  ready: boolean;
  /** Intentionally scaled to zero — Ready=False with the Hibernated reason.
   *  Distinguishes a hibernated agent from one still starting. */
  hibernated: boolean;
  /** Last reconcile error, surfaced from the Reconciled condition. */
  error?: string;
}

/** Map the controller's conditions to the public-facing AgentState. Purely
 *  condition-driven (ADR-059) — the non-authoritative phase is not read. */
export function computeAgentState(infra: InfraAgent): AgentState {
  if (infra.error) return "error";
  if (infra.ready) return "running";
  if (infra.hibernated) return "hibernated";
  return "starting";
}

/** The status of the controller-published `Ready` condition (ADR-059), or
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

export function agentOwner(obj: KubeObject): string | undefined {
  return obj.metadata?.labels?.[LABEL_OWNER];
}

export function agentIsOwnedBy(obj: KubeObject, owner: string): boolean {
  return agentOwner(obj) === owner;
}

export function parseInfraAgent(obj: KubeObject): InfraAgent {
  const id = obj.metadata?.name ?? "";
  // obj.spec is the generated AgentSpecCR (K8s validated it at admission,
  // ADR-058) and is the public spec as-is — the grants are api-server-written
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
  };
}

export function assembleAgent(
  infra: InfraAgent,
  channels: ChannelConfig[],
  allowedUserEmails: string[],
): Agent {
  return {
    id: infra.id,
    name: infra.name,
    templateId: infra.templateId,
    spec: infra.spec,
    state: computeAgentState(infra),
    error: infra.error,
    channels,
    allowedUserEmails,
  };
}

export function buildAgentObject(
  spec: Record<string, unknown>,
  owner: string,
  templateId?: string,
): AgentObject {
  const labels: Record<string, string> = { [LABEL_OWNER]: owner };
  if (templateId) labels[LABEL_TEMPLATE_REF] = templateId;

  return {
    apiVersion: SPEC_VERSION,
    kind: KIND_AGENT,
    metadata: {
      name: generateK8sName("agent"),
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
