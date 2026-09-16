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
 * UNIT_BOUNDARY_DESCRIPTION: The onboarding command a knowledge-base template
 * opens on, read from the built-in kit that declares that template — the kit
 * file is the one place it is written down. The Knowledge Bases form's create
 * reaches it through this port; a template no resolved kit declares yields
 * nothing, and that knowledge base opens idle.
 */
export function knowledgeBaseOnboardingCommand(
  repo: Pick<StarterKitsRepository, "list">,
): (kbTemplateId: KnowledgeBaseTemplateId) => Promise<string | undefined> {
  return async (kbTemplateId) => {
    const kit = (await repo.list()).find(
      (loaded) => loaded.kit.knowledgeBase?.template === kbTemplateId,
    )?.kit;
    return kit?.onboarding && "command" in kit.onboarding
      ? kit.onboarding.command
      : undefined;
  };
}

export function composeStarterKitsForOwner(
  opts: StarterKitsServiceDeps & { repo: StarterKitsRepository },
): { starterKits: StarterKitsService } {
  return { starterKits: createStarterKitsService(opts) };
}
