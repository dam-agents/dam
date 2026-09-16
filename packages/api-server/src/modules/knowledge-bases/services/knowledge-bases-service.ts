import { TRPCError } from "@trpc/server";
import type {
  Agent,
  KnowledgeBaseCreateInput,
  KnowledgeBasesService,
  KnowledgeBaseTemplateId,
  StarterKitApplyInput,
  StarterKitApplyResult,
} from "api-server-api";

export interface KnowledgeBasesDeps {
  kitForTemplate: (
    kbTemplateId: KnowledgeBaseTemplateId,
  ) => Promise<{ catalog: string; kitId: string } | undefined>;
  applyKit: (input: StarterKitApplyInput) => Promise<StarterKitApplyResult>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Knowledge Bases form's create, kept for the
 * form until it retires. A knowledge base is a regular starter kit, so this
 * only finds the built-in kit that declares the picked template and applies
 * it with the form's choices; the kit owns the marker, the install and the
 * first session.
 */
export function createKnowledgeBasesService(
  deps: KnowledgeBasesDeps,
): KnowledgeBasesService {
  return {
    async create(input: KnowledgeBaseCreateInput): Promise<Agent> {
      const kit = await deps.kitForTemplate(input.kbTemplateId);
      if (!kit)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `no starter kit declares the knowledge-base template "${input.kbTemplateId}"`,
        });
      const { agent } = await deps.applyKit({
        catalog: kit.catalog,
        kitId: kit.kitId,
        name: input.name,
        templateId: input.templateId,
        connectionIds: input.connectionIds ?? [],
        skipSchedules: [],
        scheduleOverrides: [],
      });
      return agent;
    },
  };
}
