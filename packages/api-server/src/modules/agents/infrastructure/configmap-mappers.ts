/**
 * Pure functions for converting between K8s ConfigMaps and domain objects.
 *
 * - parse*  : V1ConfigMap → domain type
 * - build*  : domain data  → V1ConfigMap body
 * - helpers : predicates and small utilities
 */
import type * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import crypto from "node:crypto";
import type {
  Template, TemplateSpec,
  Agent, AgentSpec,
  Schedule, ScheduleSpec, ScheduleStatus,
} from "api-server-api";
import type { InfraInstance } from "../domain/instance-assembly.js";
import {
  LABEL_TYPE, LABEL_OWNER, LABEL_TEMPLATE_REF, LABEL_AGENT_REF,
  LABEL_INSTANCE_REF,
  TYPE_AGENT, TYPE_INSTANCE, TYPE_SCHEDULE,
  SPEC_KEY, STATUS_KEY, LAST_ACTIVITY_KEY,
} from "./labels.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generateK8sName(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}

export function specYaml(cm: k8s.V1ConfigMap): unknown {
  return yaml.load(cm.data?.[SPEC_KEY] ?? "");
}

function displayName(cm: k8s.V1ConfigMap): string {
  const spec = specYaml(cm) as { name?: string } | null;
  return spec?.name ?? cm.metadata!.name!;
}

export function isOwnedBy(cm: k8s.V1ConfigMap, owner: string): boolean {
  return cm.metadata?.labels?.[LABEL_OWNER] === owner;
}

export function hasType(cm: k8s.V1ConfigMap, type: string): boolean {
  return cm.metadata?.labels?.[LABEL_TYPE] === type;
}

export function isPodReady(pod: k8s.V1Pod): boolean {
  const cond = pod.status?.conditions?.find((c) => c.type === "Ready");
  return cond?.status === "True";
}

// ---------------------------------------------------------------------------
// Parsing (ConfigMap → domain)
// ---------------------------------------------------------------------------

export function parseTemplate(cm: k8s.V1ConfigMap): Template {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as TemplateSpec;
  return { id: cm.metadata!.name!, name: displayName(cm), spec };
}

export function parseAgent(cm: k8s.V1ConfigMap): Agent {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as AgentSpec;
  return {
    id: cm.metadata!.name!,
    name: displayName(cm),
    templateId: cm.metadata!.labels?.[LABEL_TEMPLATE_REF],
    spec,
  };
}

interface RawInstanceSpec {
  name?: string;
  agentId: string;
  desiredState: "running" | "hibernated";
  description?: string;
  experimentalCredentialInjector?: boolean;
}

export function parseInfraInstance(cm: k8s.V1ConfigMap, pod?: k8s.V1Pod): InfraInstance {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as RawInstanceSpec;
  const statusYaml = cm.data?.[STATUS_KEY];
  let currentState: InfraInstance["currentState"];
  let error: string | undefined;
  if (statusYaml) {
    const raw = yaml.load(statusYaml) as { currentState?: string; error?: string };
    currentState = raw.currentState as InfraInstance["currentState"];
    error = raw.error || undefined;
  }
  return {
    id: cm.metadata!.name!,
    name: spec.name ?? cm.metadata!.name!,
    agentId: spec.agentId,
    description: spec.description,
    desiredState: spec.desiredState,
    currentState,
    error,
    podReady: pod ? isPodReady(pod) : false,
    experimentalCredentialInjector: spec.experimentalCredentialInjector,
  };
}

export function parseSchedule(cm: k8s.V1ConfigMap): Schedule {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as ScheduleSpec;
  const statusYaml = cm.data?.[STATUS_KEY];
  let status: ScheduleStatus | undefined;
  if (statusYaml) {
    status = yaml.load(statusYaml) as ScheduleStatus;
  }
  return {
    id: cm.metadata!.name!,
    name: displayName(cm),
    instanceId: cm.metadata!.labels![LABEL_INSTANCE_REF],
    spec,
    status,
  };
}

// ---------------------------------------------------------------------------
// Building (domain → ConfigMap)
// ---------------------------------------------------------------------------

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
    metadata: { name: generateK8sName("agent"), labels },
    data: { [SPEC_KEY]: yaml.dump(spec) },
  };
}

export function buildInstanceConfigMap(
  agentId: string,
  spec: Record<string, unknown>,
  owner: string,
): k8s.V1ConfigMap {
  return {
    metadata: {
      name: generateK8sName("inst"),
      labels: {
        [LABEL_TYPE]: TYPE_INSTANCE,
        [LABEL_AGENT_REF]: agentId,
        [LABEL_OWNER]: owner,
      },
      annotations: {
        [LAST_ACTIVITY_KEY]: new Date().toISOString(),
      },
    },
    data: { [SPEC_KEY]: yaml.dump(spec) },
  };
}

export function buildScheduleConfigMap(
  instanceId: string,
  agentRef: string,
  spec: Record<string, unknown>,
  owner: string,
): k8s.V1ConfigMap {
  return {
    metadata: {
      name: generateK8sName("sched"),
      labels: {
        [LABEL_TYPE]: TYPE_SCHEDULE,
        [LABEL_INSTANCE_REF]: instanceId,
        [LABEL_AGENT_REF]: agentRef,
        [LABEL_OWNER]: owner,
      },
    },
    data: { [SPEC_KEY]: yaml.dump(spec) },
  };
}

// ---------------------------------------------------------------------------
// ConfigMap mutations (return a modified copy of `data`)
// ---------------------------------------------------------------------------

export function patchSpecField(
  cm: k8s.V1ConfigMap,
  patch: Record<string, unknown>,
): Record<string, string> {
  const raw = yaml.load(cm.data?.[SPEC_KEY] ?? "") as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) raw[k] = v;
  }
  return { ...cm.data, [SPEC_KEY]: yaml.dump(raw) };
}

export function setDesiredState(
  cm: k8s.V1ConfigMap,
  state: "running" | "hibernated",
): k8s.V1ConfigMap {
  const raw = yaml.load(cm.data?.[SPEC_KEY] ?? "") as Record<string, unknown>;
  raw.desiredState = state;
  return {
    ...cm,
    metadata: {
      ...cm.metadata,
      annotations: {
        ...cm.metadata?.annotations,
        [LAST_ACTIVITY_KEY]: new Date().toISOString(),
      },
    },
    data: { ...cm.data, [SPEC_KEY]: yaml.dump(raw) },
  };
}
