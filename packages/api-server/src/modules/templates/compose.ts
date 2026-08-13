import type { TemplatesService, TemplateSpec } from "api-server-api";
import type { TemplatesRepository } from "./infrastructure/templates-repository.js";
import { createTemplatesService } from "./services/templates-service.js";

export type ReadTemplateSpec = (
  id: string,
) => Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;

export function composeTemplatesModule(repo: TemplatesRepository): {
  templates: TemplatesService;
  readSpec: ReadTemplateSpec;
} {
  return {
    templates: createTemplatesService({ repo }),
    readSpec: (id) => repo.readSpec(id),
  };
}
