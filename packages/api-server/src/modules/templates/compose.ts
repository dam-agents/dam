import type * as k8s from "@kubernetes/client-node";
import type { TemplatesService, TemplateSpec } from "api-server-api";
import { createK8sClient } from "../agents/infrastructure/k8s.js";
import { createTemplatesRepository } from "./infrastructure/templates-repository.js";
import { createTemplatesService } from "./services/templates-service.js";

export type ReadTemplateSpec = (
  id: string,
) => Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;

export function composeTemplatesModule(
  api: k8s.CoreV1Api,
  namespace: string,
): {
  templates: TemplatesService;
  readSpec: ReadTemplateSpec;
} {
  const k8s = createK8sClient(api, namespace);
  const repo = createTemplatesRepository(k8s);
  return {
    templates: createTemplatesService({ repo }),
    readSpec: (id) => repo.readSpec(id),
  };
}
