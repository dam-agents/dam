import type * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import type { Agent, AgentSpec } from "api-server-api";
import {
  LABEL_TYPE,
  LABEL_OWNER,
  LABEL_TEMPLATE_REF,
  TYPE_AGENT,
  SPEC_KEY,
} from "./labels.js";
import { displayName, generateK8sName } from "./configmap-mappers.js";

export function parseAgent(cm: k8s.V1ConfigMap): Agent {
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as AgentSpec;
  return {
    id: cm.metadata!.name!,
    name: displayName(cm),
    templateId: cm.metadata!.labels?.[LABEL_TEMPLATE_REF],
    spec,
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
    metadata: { name: generateK8sName("agent"), labels },
    data: { [SPEC_KEY]: yaml.dump(spec) },
  };
}
