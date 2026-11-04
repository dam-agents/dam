import { useEffect, useRef } from "react";

import { useStore } from "../../../store.js";
import {
  useAssistantOn,
  useAssistantState,
} from "../../assistants/api/assistant-state.js";
import { useInstallCapabilities } from "../../features/api/queries.js";
import { useAgents } from "../api/queries.js";
import { landingAssistantId } from "../lib/assistant-landing.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The first thing a person meets when their
 * assistant has not been used yet is the assistant's chat, not Home: signing in
 * with an unused assistant lands there once per page load, and every later visit
 * to Home stays where they put it. The decision waits for the agent list and the
 * assistant's own record, so whichever arrives first cannot spend the one-shot;
 * the assistant must be in the list, so a row whose Agent is still being made
 * lands nowhere.
 */
export function useLandInAssistantChat(): void {
  const landed = useRef(false);
  const view = useStore((s) => s.view);
  const agents = useAgents();
  const install = useInstallCapabilities();
  const assistantOn = useAssistantOn();
  const { data: state, isSuccess: stateLoaded } = useAssistantState();
  const stateKnown = install.isSuccess && (!assistantOn || stateLoaded);
  const listed =
    agents.data?.list.some((agent) => agent.id === state?.agentId) ?? false;

  useEffect(() => {
    if (landed.current) return;
    const decision = landingAssistantId({
      view,
      listLoaded: agents.isSuccess,
      stateLoaded: stateKnown,
      assistantId: listed ? (state?.agentId ?? null) : null,
      used: state?.used,
    });
    if (!decision.decide) return;
    landed.current = true;
    if (decision.landIn !== null)
      useStore.getState().selectAgent(decision.landIn);
  }, [agents.isSuccess, listed, state, stateKnown, view]);
}
