import type * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import { scheduleSpecSchema, scheduleStatusSchema } from "api-server-api";
import type { Schedule } from "api-server-api";
import {
  LABEL_TYPE,
  LABEL_OWNER,
  LABEL_AGENT_REF,
  LABEL_CREATED_BY,
  TYPE_SCHEDULE,
  SPEC_KEY,
  STATUS_KEY,
} from "../../agents/infrastructure/labels.js";
import {
  displayName,
  generateK8sName,
} from "../../agents/infrastructure/configmap-mappers.js";

export function parseSchedule(cm: k8s.V1ConfigMap): Schedule {
  const spec = scheduleSpecSchema.parse(yaml.load(cm.data?.[SPEC_KEY] ?? ""));
  if (spec.createdBy !== "agent") spec.createdBy = "user";
  const statusYaml = cm.data?.[STATUS_KEY];
  let status: Schedule["status"];
  if (statusYaml) {
    status = scheduleStatusSchema.parse(yaml.load(statusYaml));
  }
  return {
    id: cm.metadata!.name!,
    name: displayName(cm),
    agentId: cm.metadata!.labels![LABEL_AGENT_REF],
    spec,
    status,
  };
}

export function buildScheduleConfigMap(
  agentId: string,
  spec: Record<string, unknown>,
  owner: string,
): k8s.V1ConfigMap {
  const createdBy =
    (spec as { createdBy?: string }).createdBy === "agent" ? "agent" : "user";
  const labels: Record<string, string> = {
    [LABEL_TYPE]: TYPE_SCHEDULE,
    [LABEL_AGENT_REF]: agentId,
    [LABEL_OWNER]: owner,
    [LABEL_CREATED_BY]: createdBy,
  };
  return {
    metadata: { name: generateK8sName("sched"), labels },
    data: { [SPEC_KEY]: yaml.dump(spec) },
  };
}
