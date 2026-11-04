import { useEffect, useRef } from "react";

import { useStore } from "../../../store.js";
import { useAssistantState } from "../../assistants/api/assistant-state.js";
import { useAgentsList } from "../api/queries.js";
import { landingAssistantId } from "../lib/assistant-landing.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The first thing a person meets when their
 * assistant has not been used yet is the assistant's chat, not Home: signing in
 * with an unused assistant lands there once per page load, and every later visit
 * to Home stays where they put it. The assistant must be in the agent list, so a
 * row whose Agent is still being made lands nowhere.
 */
export function useLandInAssistantChat(): void {
  const landed = useRef(false);
  const view = useStore((s) => s.view);
  const { data: state } = useAssistantState();
  const listed =
    useAgentsList().some((agent) => agent.id === state?.agentId) ?? false;

  useEffect(() => {
    if (landed.current) return;
    const landIn = landingAssistantId({
      view,
      assistantId: listed ? (state?.agentId ?? null) : null,
      used: state?.used,
    });
    if (landIn === null && state === undefined) return;
    landed.current = true;
    if (landIn !== null) useStore.getState().selectAgent(landIn);
  }, [listed, state, view]);
}
