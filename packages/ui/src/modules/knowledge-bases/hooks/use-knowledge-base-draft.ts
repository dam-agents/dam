import { useState } from "react";

import type { ProviderRef } from "../../providers/components/provider-item.js";
import type { EgressPreset } from "../../sandboxes/lib/wizard-snapshot.js";

export interface KnowledgeBaseDraft {
  name: string;
  providerRef: ProviderRef | null;
  egressPreset: EgressPreset;
  sizeCpuMilli: number | null;
  sizeMemoryMi: number | null;
  connectionIds: string[];
}

const INITIAL_DRAFT: KnowledgeBaseDraft = {
  name: "",
  providerRef: null,
  egressPreset: "trusted",
  sizeCpuMilli: null,
  sizeMemoryMi: null,
  connectionIds: [],
};

/** In-memory draft for the knowledge-base create form. Deliberately not
 *  persisted (unlike the sandbox wizard snapshot): the form is a single page,
 *  so there is no multi-step progress to protect. */
export function useKnowledgeBaseDraft() {
  const [draft, setDraft] = useState(INITIAL_DRAFT);
  const update = (patch: Partial<KnowledgeBaseDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const toggleConnection = (id: string, on: boolean) =>
    setDraft((current) => ({
      ...current,
      connectionIds: on
        ? [...new Set([...current.connectionIds, id])]
        : current.connectionIds.filter((x) => x !== id),
    }));

  return { draft, update, toggleConnection };
}
