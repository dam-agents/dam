import type * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import {
  ANN_GRANTED_CONNECTION_IDS,
  ANN_GRANTED_SECRET_IDS,
  LABEL_TYPE, LABEL_OWNER, LABEL_AGENT_REF, LAST_ACTIVITY_KEY,
  TYPE_INSTANCE, SPEC_KEY, STATUS_KEY,
} from "../../agents/infrastructure/labels.js";
import {
  generateK8sName, isPodReady,
} from "../../agents/infrastructure/configmap-mappers.js";
import type { InfraInstance } from "../domain/instance-assembly.js";

interface RawInstanceSpec {
  name?: string;
  agentId: string;
  desiredState: "running" | "hibernated";
  description?: string;
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
