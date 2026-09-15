import type { AgentsService, KnowledgeBasesService } from "api-server-api";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import type { ReadTemplateSpec } from "../templates/index.js";
import {
  type CreateKnowledgeBaseAgent,
  createKnowledgeBaseAgentFactory,
  createKnowledgeBasesService,
} from "./services/knowledge-bases-service.js";

export function composeKnowledgeBasesForOwner(opts: {
  owner: string;
  surface: string;
  agents: AgentsService;
  readTemplateSpec: ReadTemplateSpec;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
}): {
  knowledgeBases: KnowledgeBasesService;
  createKnowledgeBaseAgent: CreateKnowledgeBaseAgent;
} {
  return {
    knowledgeBases: createKnowledgeBasesService(opts),
    createKnowledgeBaseAgent: createKnowledgeBaseAgentFactory(opts),
  };
}
