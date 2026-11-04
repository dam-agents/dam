import { SESSION_CATEGORIES } from "api-server-api";
import { useEffect, useRef } from "react";

import { useStore } from "../../../store.js";
import { useSessionPages } from "../../sessions/api/queries.js";
import { useAgentsList, useIsAgentAnswerableSoon } from "../api/queries.js";
import { landingAssistantId } from "../lib/assistant-landing.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The first thing a person meets when their
 * assistant has not been used yet is the assistant's chat, not Home: signing in
 * with an empty assistant lands there once per page load, and every later visit
 * to Home stays where they put it.
 */
export function useLandInAssistantChat(): void {
  const landed = useRef(false);
  const view = useStore((s) => s.view);
  const assistant =
    useAgentsList().find((agent) => agent.kind === "assistant") ?? null;
  const answerable = useIsAgentAnswerableSoon(assistant?.id ?? null);
  const { sessions } = useSessionPages(
    assistant?.id ?? null,
    [...SESSION_CATEGORIES],
    { enabled: answerable },
  );

  useEffect(() => {
    if (landed.current) return;
    const landIn = landingAssistantId({
      view,
      assistantId: assistant?.id ?? null,
      sessions,
    });
    if (landIn === null && sessions === undefined) return;
    landed.current = true;
    if (landIn !== null) useStore.getState().selectAgent(landIn);
  }, [assistant, sessions, view]);
}
