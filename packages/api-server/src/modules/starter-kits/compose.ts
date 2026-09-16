import type {
  KnowledgeBaseTemplateId,
  StarterKitsService,
} from "api-server-api";
import type { StarterKitsRepository } from "./infrastructure/kits-repository.js";
import {
  createStarterKitsService,
  type StarterKitsServiceDeps,
} from "./services/starter-kits-service.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which built-in kit a knowledge-base template is —
 * the kit that declares it. A knowledge base is a regular starter kit; the
 * Knowledge Bases form, kept until it retires, only needs to know which one to
 * apply for the template the user picked.
 */
export function kitForKnowledgeBaseTemplate(
  repo: Pick<StarterKitsRepository, "list">,
): (
  kbTemplateId: KnowledgeBaseTemplateId,
) => Promise<{ catalog: string; kitId: string } | undefined> {
  return async (kbTemplateId) => {
    const loaded = (await repo.list()).find(
      (candidate) => candidate.kit.knowledgeBase?.template === kbTemplateId,
    );
    return loaded
      ? { catalog: loaded.catalog, kitId: loaded.kit.id }
      : undefined;
  };
}

export function composeStarterKitsForOwner(
  opts: StarterKitsServiceDeps & { repo: StarterKitsRepository },
): { starterKits: StarterKitsService } {
  return { starterKits: createStarterKitsService(opts) };
}
