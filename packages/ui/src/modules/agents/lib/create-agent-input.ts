import type { EgressPreset } from "../../../types.js";
import type { ProviderRef } from "../../providers/components/provider-item.js";
import type { CreateAgentInput } from "../api/mutations.js";

export interface CreateAgentDraft {
  name: string;
  templateId: string | null;
  providerRef: ProviderRef | null;
  egressPreset: EgressPreset;
}

export function isCreateAgentDraftComplete(draft: CreateAgentDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    draft.templateId !== null &&
    draft.providerRef !== null
  );
}

export function buildCreateAgentInput(
  draft: CreateAgentDraft,
): CreateAgentInput {
  if (!isCreateAgentDraftComplete(draft)) {
    throw new Error("cannot build create-agent input from an incomplete draft");
  }
  return {
    name: draft.name.trim(),
    templateId: draft.templateId!,
    egressPreset: draft.egressPreset,
    appConnectionIds: [draft.providerRef!.id],
  };
}
