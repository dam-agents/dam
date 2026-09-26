import type { TemplatesService, TemplateSpec } from "api-server-api";
import type { TemplatesRepository } from "./infrastructure/templates-repository.js";

export type ReadTemplateSpec = (
  id: string,
) => Promise<{ spec: TemplateSpec } | null>;

export function composeTemplatesModule(repo: TemplatesRepository): {
  templates: TemplatesService;
  readSpec: ReadTemplateSpec;
} {
  return {
    templates: {
      list: () => repo.list(),
      get: (id) => repo.get(id),
    },
    readSpec: (id) => repo.readSpec(id),
  };
}
