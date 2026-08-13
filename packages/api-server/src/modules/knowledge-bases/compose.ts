import type { AgentsService, KnowledgeBasesService } from "api-server-api";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import { createKnowledgeBasesService } from "./services/knowledge-bases-service.js";

export function composeKnowledgeBasesForOwner(opts: {
  owner: string;
  agents: AgentsService;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
}): { knowledgeBases: KnowledgeBasesService } {
  return {
    knowledgeBases: createKnowledgeBasesService({
      owner: opts.owner,
      agents: opts.agents,
      runtimeMutator: opts.runtimeMutator,
      wakeAgent: opts.wakeAgent,
    }),
  };
}
