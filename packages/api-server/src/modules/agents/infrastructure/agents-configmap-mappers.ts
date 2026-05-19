import type * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import type {
  Agent,
  AgentSpec,
  AgentState,
  ChannelConfig,
} from "api-server-api";
import {
  ANN_GRANTED_CONNECTION_IDS,
  ANN_GRANTED_SECRET_IDS,
  LABEL_TYPE,
  LABEL_OWNER,
  LABEL_TEMPLATE_REF,
  LAST_ACTIVITY_KEY,
  TYPE_AGENT,
  SPEC_KEY,
  STATUS_KEY,
} from "./labels.js";
import {
  displayName,
  generateK8sName,
  isPodReady,
} from "./configmap-mappers.js";

/** The raw observed lifecycle from the agent's status.yaml. */
export interface InfraAgent {
  id: string;
  name: string;
  templateId?: string;
  spec: AgentSpec;
  desiredState: "running" | "hibernated";
  currentState?: "running" | "hibernated" | "error";
  error?: string;
  podReady: boolean;
}

/** Synthesise the public-facing state from observed + desired. Mirrors the
 *  computeState that lived in the pre-merge instance-assembly. */
export function computeAgentState(infra: InfraAgent): AgentState {
  if (infra.currentState === "error") return "error";
  if (infra.desiredState === "running" && infra.currentState !== "running")
    return "starting";
  if (infra.desiredState === "hibernated" && infra.currentState === "running")
    return "hibernating";
  if (infra.desiredState === "hibernated") return "hibernated";
  if (!infra.podReady) return "starting";
  return "running";
}

export function parseInfraAgent(
  cm: k8s.V1ConfigMap,
  pod?: k8s.V1Pod,
): InfraAgent {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as AgentSpec;
  const statusYaml = cm.data?.[STATUS_KEY];
  let currentState: InfraAgent["currentState"];
  let error: string | undefined;
  if (statusYaml) {
    const raw = yaml.load(statusYaml) as {
      currentState?: string;
      error?: string;
    };
    currentState = raw.currentState as InfraAgent["currentState"];
    error = raw.error || undefined;
  }
  return {
    id: cm.metadata!.name!,
    name: spec.name ?? displayName(cm),
    templateId: cm.metadata?.labels?.[LABEL_TEMPLATE_REF],
    spec,
    desiredState: spec.desiredState ?? "running",
    currentState,
    error,
    podReady: pod ? isPodReady(pod) : false,
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
    error: infra.currentState === "error" ? infra.error : undefined,
    channels,
    allowedUserEmails,
  };
}

export function buildAgentConfigMap(
  spec: Record<string, unknown>,
  owner: string,
  templateId?: string,
): k8s.V1ConfigMap {
  const labels: Record<string, string> = {
    [LABEL_TYPE]: TYPE_AGENT,
    [LABEL_OWNER]: owner,
  };
  if (templateId) labels[LABEL_TEMPLATE_REF] = templateId;

  return {
    metadata: {
      name: generateK8sName("agent"),
      labels,
      annotations: {
        [LAST_ACTIVITY_KEY]: new Date().toISOString(),
        // Initialize both grant annotations to "" explicitly. Both grants
        // are always selective; absent annotations would also read as
        // empty after the legacy "all granted" mode was removed, but
        // writing them at creation makes the intent visible on the CM
        // and avoids surprises if a future read ever defaults differently.
        [ANN_GRANTED_SECRET_IDS]: "",
        [ANN_GRANTED_CONNECTION_IDS]: "",
      },
    },
    data: { [SPEC_KEY]: yaml.dump(spec) },
  };
}

export function findOrphanedAgentIds(
  infraIds: Set<string>,
  psqlAgentIds: string[],
): string[] {
  return psqlAgentIds.filter((id) => !infraIds.has(id));
}
