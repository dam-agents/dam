import type { EgressPreset } from "../../../types.js";
import type { CreateAgentInput } from "../api/mutations.js";

export interface CreateAgentDraft {
  name: string;
  egressPreset: EgressPreset;
  vm: boolean;
}

export function isCreateAgentDraftComplete(draft: CreateAgentDraft): boolean {
  return draft.name.trim().length > 0;
}

export function buildCreateAgentInput(
  draft: CreateAgentDraft,
): CreateAgentInput {
  if (!isCreateAgentDraftComplete(draft)) {
    throw new Error("cannot build create-agent input from an incomplete draft");
  }
  return {
    name: draft.name.trim(),
    egressPreset: draft.egressPreset,
    ...(draft.vm ? { vm: true } : {}),
  };
}
