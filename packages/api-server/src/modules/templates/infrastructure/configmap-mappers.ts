import type * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import { templateSpecSchema } from "api-server-api";
import type { Template } from "api-server-api";
import { SPEC_KEY } from "../../agents/infrastructure/labels.js";
import { displayName } from "../../agents/infrastructure/configmap-mappers.js";

export function parseTemplate(cm: k8s.V1ConfigMap): Template {
  const spec = templateSpecSchema.parse(yaml.load(cm.data?.[SPEC_KEY] ?? ""));
  return { id: cm.metadata!.name!, name: displayName(cm), spec };
}
