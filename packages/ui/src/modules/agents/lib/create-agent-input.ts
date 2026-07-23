/** Pure assembly of the create-agent mutation input from an inline draft —
 *  node-testable, no DOM. Kept separate from the component so the required-field
 *  gate and the provider→connection mapping can be unit-tested directly. */

import type { EgressPreset } from "../../../types.js";
import type { ProviderRef } from "../../providers/components/provider-item.js";
import type { CreateAgentInput } from "../api/mutations.js";

export interface CreateAgentDraft {
  name: string;
  templateId: string | null;
  providerRef: ProviderRef | null;
  egressPreset: EgressPreset;
}

/** A draft is complete once it can create a functional agent: a name, a base
 *  template, and a model provider to run turns under. */
export function isCreateAgentDraftComplete(draft: CreateAgentDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    draft.templateId !== null &&
    draft.providerRef !== null
  );
}

/** Assemble the mutation input from a completed draft. The chosen provider
 *  rides in as the sole app-connection grant, mirroring the sandbox wizard, so
 *  credentials are present on the first snapshot. Throws on an incomplete
 *  draft — callers gate on {@link isCreateAgentDraftComplete} first. */
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
