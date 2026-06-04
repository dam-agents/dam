import type { TemplatesService, TemplateSpec } from "api-server-api";
import type { TemplatesRepository } from "./infrastructure/templates-repository.js";
import { createTemplatesService } from "./services/templates-service.js";

export type ReadTemplateSpec = (
  id: string,
) => Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;

/** Wraps the pre-built (boot-loaded) templates repository into the service +
 *  read-spec port. The repo is constructed once at app startup (ADR-058:
 *  templates are file-mounted config, not read dynamically per request). */
export function composeTemplatesModule(repo: TemplatesRepository): {
  templates: TemplatesService;
  readSpec: ReadTemplateSpec;
} {
  return {
    templates: createTemplatesService({ repo }),
    readSpec: (id) => repo.readSpec(id),
  };
}
