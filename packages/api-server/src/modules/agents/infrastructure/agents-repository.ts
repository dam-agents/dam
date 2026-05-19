import type { Agent } from "api-server-api";
import type { K8sClient } from "./k8s.js";
import { LABEL_TYPE, TYPE_AGENT, LABEL_OWNER } from "./labels.js";
import { isOwnedBy, hasType, patchSpecField } from "./configmap-mappers.js";
import { parseAgent, buildAgentConfigMap } from "./agents-configmap-mappers.js";

export interface AgentsRepository {
  list(owner: string): Promise<Agent[]>;
  get(id: string, owner: string): Promise<Agent | null>;
  create(
    spec: Record<string, unknown>,
    owner: string,
    templateId?: string,
  ): Promise<Agent>;
  updateSpec(
    id: string,
    owner: string,
    patch: Record<string, unknown>,
  ): Promise<Agent | null>;
  delete(id: string, owner: string): Promise<void>;
}

export function createAgentsRepository(k8s: K8sClient): AgentsRepository {
  return {
    async list(owner) {
      const cms = await k8s.listConfigMaps(
        `${LABEL_TYPE}=${TYPE_AGENT},${LABEL_OWNER}=${owner}`,
      );
      return cms.map(parseAgent);
    },

    async get(id, owner) {
      const cm = await k8s.getConfigMap(id);
      if (!cm || !isOwnedBy(cm, owner) || !hasType(cm, TYPE_AGENT)) return null;
      return parseAgent(cm);
    },

    async create(spec, owner, templateId?) {
      const body = buildAgentConfigMap(spec, owner, templateId);
      const created = await k8s.createConfigMap(body);
      return parseAgent(created);
    },

    async updateSpec(id, owner, patch) {
      const cm = await k8s.getConfigMap(id);
      if (!cm || !isOwnedBy(cm, owner) || !hasType(cm, TYPE_AGENT)) return null;
      cm.data = patchSpecField(cm, patch);
      const updated = await k8s.replaceConfigMap(id, cm);
      return parseAgent(updated);
    },

    async delete(id, owner) {
      const cm = await k8s.getConfigMap(id);
      if (!cm || !isOwnedBy(cm, owner) || !hasType(cm, TYPE_AGENT)) return;
      await k8s.deleteConfigMap(id);
    },
  };
}
