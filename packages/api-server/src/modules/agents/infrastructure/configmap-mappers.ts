/**
 * Generic helpers shared across modules that read/write platform ConfigMaps.
 * Per-module parsers (parseTemplate, parseAgent, parseInfraInstance,
 * parseSchedule) live in each module's own infrastructure folder.
 */
import type * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import crypto from "node:crypto";
import {
  LABEL_TYPE,
  LABEL_OWNER,
  SPEC_KEY,
  LAST_ACTIVITY_KEY,
} from "./labels.js";

export function generateK8sName(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}

export function specYaml(cm: k8s.V1ConfigMap): unknown {
  return yaml.load(cm.data?.[SPEC_KEY] ?? "");
}

export function displayName(cm: k8s.V1ConfigMap): string {
  const spec = specYaml(cm);
  if (spec != null && typeof spec === "object" && "name" in spec) {
    const name = (spec as { name: unknown }).name;
    if (typeof name === "string") return name;
  }
  return cm.metadata!.name!;
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
