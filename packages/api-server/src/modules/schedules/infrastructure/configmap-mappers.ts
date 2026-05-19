import type * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import type { Schedule, ScheduleSpec, ScheduleStatus } from "api-server-api";
import {
  LABEL_TYPE,
  LABEL_OWNER,
  LABEL_INSTANCE_REF,
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
  const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as ScheduleSpec;
  if (spec.createdBy !== "agent") spec.createdBy = "user";
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

export function buildScheduleConfigMap(
  instanceId: string,
  agentRef: string,
  spec: Record<string, unknown>,
  owner: string,
): k8s.V1ConfigMap {
  const createdBy =
    (spec as { createdBy?: string }).createdBy === "agent" ? "agent" : "user";
  const labels: Record<string, string> = {
    [LABEL_TYPE]: TYPE_SCHEDULE,
    [LABEL_INSTANCE_REF]: instanceId,
    [LABEL_AGENT_REF]: agentRef,
    [LABEL_OWNER]: owner,
    [LABEL_CREATED_BY]: createdBy,
  };
  return {
    metadata: { name: generateK8sName("sched"), labels },
    data: { [SPEC_KEY]: yaml.dump(spec) },
  };
}
