import type { Template, TemplateSpec } from "api-server-api";
import yaml from "js-yaml";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import {
  LABEL_TYPE, TYPE_TEMPLATE, LABEL_OWNER, SPEC_KEY,
} from "../../agents/infrastructure/labels.js";
import { hasType } from "../../agents/infrastructure/configmap-mappers.js";
import { parseTemplate } from "./configmap-mappers.js";

export interface TemplatesRepository {
  list(): Promise<Template[]>;
  get(id: string): Promise<Template | null>;
  readSpec(id: string): Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;
}

export function createTemplatesRepository(k8s: K8sClient): TemplatesRepository {
  return {
    async list() {
      const cms = await k8s.listConfigMaps(`${LABEL_TYPE}=${TYPE_TEMPLATE}`);
      return cms
        .filter((cm) => !cm.metadata?.labels?.[LABEL_OWNER])
        .map(parseTemplate);
    },

    async get(id) {
      const cm = await k8s.getConfigMap(id);
      if (!cm || !hasType(cm, TYPE_TEMPLATE)) return null;
      if (cm.metadata?.labels?.[LABEL_OWNER]) return null;
      return parseTemplate(cm);
    },

    async readSpec(id) {
      const cm = await k8s.getConfigMap(id);
      if (!cm || !hasType(cm, TYPE_TEMPLATE)) return null;
      return {
        spec: yaml.load(cm.data?.[SPEC_KEY] ?? "") as TemplateSpec,
        isOwned: !!cm.metadata?.labels?.[LABEL_OWNER],
      };
    },
  };
}
