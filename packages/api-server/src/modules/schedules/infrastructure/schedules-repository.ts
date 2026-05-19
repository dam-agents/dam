import type { Schedule, ScheduleSpec } from "api-server-api";
import yaml from "js-yaml";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import {
  LABEL_TYPE,
  TYPE_SCHEDULE,
  LABEL_OWNER,
  LABEL_INSTANCE_REF,
  LABEL_AGENT_REF,
  SPEC_KEY,
} from "../../agents/infrastructure/labels.js";
import { isOwnedBy } from "../../agents/infrastructure/configmap-mappers.js";
import { parseSchedule, buildScheduleConfigMap } from "./configmap-mappers.js";

export interface SchedulesRepository {
  list(instanceId: string, owner: string): Promise<Schedule[]>;
  get(id: string, owner: string): Promise<Schedule | null>;
  create(
    instanceId: string,
    agentRef: string,
    spec: Record<string, unknown>,
    owner: string,
  ): Promise<Schedule>;
  update(
    id: string,
    patch: Record<string, unknown>,
    owner: string,
  ): Promise<Schedule | null>;
  delete(id: string, owner: string): Promise<void>;
  toggle(id: string, owner: string): Promise<Schedule | null>;
  readAgentRef(instanceId: string, owner: string): Promise<string | null>;
}

export function createSchedulesRepository(k8s: K8sClient): SchedulesRepository {
  async function getOwned(id: string, owner: string) {
    const cm = await k8s.getConfigMap(id);
    if (!cm || !isOwnedBy(cm, owner)) return null;
    return cm;
  }

  return {
    async list(instanceId, owner) {
      const cms = await k8s.listConfigMaps(
        `${LABEL_TYPE}=${TYPE_SCHEDULE},${LABEL_INSTANCE_REF}=${instanceId},${LABEL_OWNER}=${owner}`,
      );
      return cms.map(parseSchedule);
    },

    async get(id, owner) {
      const cm = await getOwned(id, owner);
      if (!cm) return null;
      return parseSchedule(cm);
    },

    async create(instanceId, agentRef, spec, owner) {
      const body = buildScheduleConfigMap(instanceId, agentRef, spec, owner);
      const created = await k8s.createConfigMap(body);
      return parseSchedule(created);
    },

    async update(id, patch, owner) {
      const cm = await getOwned(id, owner);
      if (!cm) return null;
      const current = yaml.load(cm.data?.[SPEC_KEY] ?? "") as Record<
        string,
        unknown
      >;
      const nextSpec = { ...current, ...patch };
      cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(nextSpec) };
      const updated = await k8s.replaceConfigMap(id, cm);
      return parseSchedule(updated);
    },

    async delete(id, owner) {
      const cm = await getOwned(id, owner);
      if (!cm) return;
      await k8s.deleteConfigMap(id);
    },

    async toggle(id, owner) {
      const cm = await getOwned(id, owner);
      if (!cm) return null;
      const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as ScheduleSpec;
      spec.enabled = !spec.enabled;
      cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
      const updated = await k8s.replaceConfigMap(id, cm);
      return parseSchedule(updated);
    },

    async readAgentRef(instanceId, owner) {
      const cm = await getOwned(instanceId, owner);
      if (!cm) return null;
      return cm.metadata!.labels![LABEL_AGENT_REF] ?? null;
    },
  };
}
