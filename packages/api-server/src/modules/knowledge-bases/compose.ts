import type { KnowledgeBasesService } from "api-server-api";

import {
  createKnowledgeBasesService,
  type KnowledgeBasesDeps,
} from "./services/knowledge-bases-service.js";

export function composeKnowledgeBasesForOwner(opts: KnowledgeBasesDeps): {
  knowledgeBases: KnowledgeBasesService;
} {
  return { knowledgeBases: createKnowledgeBasesService(opts) };
}
