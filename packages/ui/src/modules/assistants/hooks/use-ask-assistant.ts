import { useCallback } from "react";

import { getBrand } from "../../../brand.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { isOwnAgent } from "../../agents/lib/agent-editors.js";
import { useAssistantGate, useAssistantState } from "../api/assistant-state.js";
import { canAskAssistant } from "../lib/ask-prefill.js";

export interface AskAssistant {
  offered: (agent: AgentView | null) => boolean;
  label: string;
  ask: (prefill: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one thing every surface that meets an error
 * offers the person: whether the link belongs there at all, what it is called in
 * this install, and what choosing it does — the assistant's new chat with the
 * text already in its composer, left unsent, so a failure costs no turn and no
 * model call until the person sends it.
 */
export function useAskAssistant(): AskAssistant {
  const gate = useAssistantGate();
  const state = useAssistantState();
  const appendNewSessionDraft = useStore((s) => s.appendNewSessionDraft);
  const leaveChatContext = useStore((s) => s.leaveChatContext);
  const selectAgent = useStore((s) => s.selectAgent);
  const assistantId = state.data?.agentId ?? null;
  const assistantOn = gate.on;
  const assistantKnown = gate.known && state.data?.ready === true;

  const offered = useCallback(
    (agent: AgentView | null) =>
      canAskAssistant({
        assistantOn,
        assistantKnown,
        assistantId,
        agentId: agent?.id,
        isOwner: agent !== null && isOwnAgent(agent),
      }),
    [assistantOn, assistantKnown, assistantId],
  );

  const ask = useCallback(
    (prefill: string) => {
      if (assistantId === null) return;
      leaveChatContext(() => {
        appendNewSessionDraft(assistantId, prefill);
        selectAgent(assistantId);
      });
    },
    [assistantId, appendNewSessionDraft, leaveChatContext, selectAgent],
  );

  return { offered, label: `Ask ${getBrand().assistantName}`, ask };
}
