import { useEffect } from "react";

import { useStore } from "../../../store.js";
import {
  useAssistantGate,
  useAssistantState,
} from "../../assistants/api/assistant-state.js";
import { useInstallCapabilities } from "../../features/api/queries.js";
import { useAgents } from "../api/queries.js";
import { landingAssistantId } from "../lib/assistant-landing.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The first thing a person meets when their assistant
 * has not been used yet is the assistant's chat, not Home: signing in with an
 * unused assistant lands there once per page load, and every later visit to Home
 * stays where they put it. The decision waits for the feature's own answer, the
 * agent list and the assistant's record, so the last of them decides and a guess
 * never spends the one-shot; the assistant must be in the list and the feature on
 * for the person, so a record whose Agent they deleted — or one the cache kept
 * from before they turned the feature off — lands nowhere. The one-shot lives in
 * the store, so resetting a person's onboarding releases it and the next
 * evaluation routes them exactly as a first-timer is routed.
 */
export function useLandInAssistantChat(): void {
  const view = useStore((s) => s.view);
  const spent = useStore((s) => s.assistantLandingSpent);
  const agents = useAgents();
  const install = useInstallCapabilities();
  const gate = useAssistantGate();
  const { data: state, isSuccess: stateLoaded } = useAssistantState();
  const stateKnown = install.isSuccess && (!gate.on || stateLoaded);
  const listed =
    agents.data?.list.some((agent) => agent.id === state?.agentId) ?? false;

  useEffect(() => {
    if (spent) return;
    const decision = landingAssistantId({
      view,
      gateKnown: gate.known,
      assistantOn: gate.on,
      listLoaded: agents.isSuccess,
      stateLoaded: stateKnown,
      recordReady: state?.ready === true,
      assistantId: listed ? (state?.agentId ?? null) : null,
      used: state?.used,
    });
    if (!decision.decide) return;
    useStore.getState().spendAssistantLanding();
    if (decision.landIn !== null)
      useStore.getState().selectAgent(decision.landIn);
  }, [
    agents.isSuccess,
    gate.known,
    gate.on,
    listed,
    spent,
    state,
    stateKnown,
    view,
  ]);
}
