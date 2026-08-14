import { useMutation } from "@tanstack/react-query";
import type { KnowledgeBaseTemplateId } from "api-server-api";

import { api } from "../../../api.js";
import { trpc } from "../../../trpc.js";
import type { EgressPreset } from "../../../types.js";
import { agentsKeys } from "../../agents/api/queries.js";

export interface CreateKnowledgeBaseInput {
  name: string;
  templateId: string;
  kbTemplateId: KnowledgeBaseTemplateId;
  connectionIds?: string[];
  egressPreset?: EgressPreset;
}

export function useCreateKnowledgeBase() {
  return useMutation({
    mutationFn: (input: CreateKnowledgeBaseInput) =>
      api.knowledgeBases.create.mutate(input),
    meta: {
      invalidates: [
        agentsKeys.listWithChannels(),
        trpc.agents.list.queryKey(),
        trpc.budgets.reserved.queryKey(),
      ],
      errorToast: "Failed to create knowledge base",
    },
  });
}
