import type { KnowledgeBaseTemplateId } from "api-server-api";

import type { ProviderRef } from "../../providers/components/provider-item.js";
import type { CreateKnowledgeBaseInput } from "../api/mutations.js";

export interface KnowledgeBaseSetupDraft {
  name: string;
  templateId: string | null;
  kbTemplateId: KnowledgeBaseTemplateId | null;
  providerRef: ProviderRef | null;
  connectionIds: string[];
}

export function isKnowledgeBaseSetupComplete(
  draft: KnowledgeBaseSetupDraft,
): draft is KnowledgeBaseSetupDraft & {
  templateId: string;
  kbTemplateId: KnowledgeBaseTemplateId;
  providerRef: ProviderRef;
} {
  return (
    draft.name.trim().length > 0 &&
    draft.templateId !== null &&
    draft.kbTemplateId !== null &&
    draft.providerRef !== null
  );
}

export function buildKnowledgeBaseCreateInput(
  draft: KnowledgeBaseSetupDraft,
): CreateKnowledgeBaseInput {
  if (!isKnowledgeBaseSetupComplete(draft)) {
    throw new Error(
      "cannot build create-knowledge-base input from an incomplete draft",
    );
  }
  const connectionIds = [
    ...new Set([...draft.connectionIds, draft.providerRef.id]),
  ];
  return {
    name: draft.name.trim(),
    templateId: draft.templateId,
    kbTemplateId: draft.kbTemplateId,
    egressPreset: "trusted",
    connectionIds,
  };
}
