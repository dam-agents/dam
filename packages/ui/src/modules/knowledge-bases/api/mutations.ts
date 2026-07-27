import { useMutation } from "@tanstack/react-query";
import type { KnowledgeBaseTemplateId } from "api-server-api";

import { api } from "../../../api.js";
import { trpc } from "../../../trpc.js";
import type { EgressPreset } from "../../../types.js";
import { agentsKeys } from "../../agents/api/queries.js";

export interface CreateKnowledgeBaseInput {
  name: string;
  /** The pinned harness image template (claude-code); hidden in the UI. */
  templateId: string;
  /** The picked installation procedure (surfaced as "Template"). */
  kbTemplateId: KnowledgeBaseTemplateId;
  connectionIds?: string[];
  egressPreset?: EgressPreset;
}

/** A Knowledge Base is an agent under the hood, so creating one changes the
 *  agents list and Reserved compute — same invalidations as a sandbox create. */
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
