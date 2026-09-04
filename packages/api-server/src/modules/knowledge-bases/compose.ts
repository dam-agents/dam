import type { AgentsService, KnowledgeBasesService } from "api-server-api";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import {
  createKnowledgeBasesService,
  type ReadTemplateSpec,
} from "./services/knowledge-bases-service.js";

export function composeKnowledgeBasesForOwner(opts: {
  owner: string;
  surface: string;
  agents: AgentsService;
  readTemplateSpec: ReadTemplateSpec;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
}): { knowledgeBases: KnowledgeBasesService } {
  return {
    knowledgeBases: createKnowledgeBasesService({
      owner: opts.owner,
      surface: opts.surface,
      agents: opts.agents,
      readTemplateSpec: opts.readTemplateSpec,
      runtimeMutator: opts.runtimeMutator,
      wakeAgent: opts.wakeAgent,
    }),
  };
}
