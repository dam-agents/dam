import type { LibraryArtifact } from "api-server-api";
import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { artifactSessionPrefill } from "../lib/session-prefill.js";

interface StartArtifactSession {
  available: boolean;
  start: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one way to continue an artifact. It leaves the
 * artifact's reference in the publishing Agent's blank chat and opens that
 * chat, so the user reads the line and sends it. Finding the Agent in the list
 * is also the guard: an upload has no publishing Agent, a deleted one is gone
 * from the list, and the list is empty until it loads. Opening the chat resets
 * the docked slot, so it asks before discarding an unsaved edit there.
 */
export function useStartArtifactSession(
  artifact: LibraryArtifact | undefined,
): StartArtifactSession {
  const agents = useAgentsList();
  const appendNewSessionDraft = useStore((s) => s.appendNewSessionDraft);
  const selectAgent = useStore((s) => s.selectAgent);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const leaveChatContext = useStore((s) => s.leaveChatContext);

  const agent = agents.find((a) => a.id === artifact?.agentId);

  const start = useCallback(() => {
    if (!artifact || !agent) return;
    leaveChatContext(() => {
      appendNewSessionDraft(agent.id, artifactSessionPrefill(artifact));
      selectAgent(agent.id);
      setMobileScreen("chat");
    });
  }, [
    artifact,
    agent,
    leaveChatContext,
    appendNewSessionDraft,
    selectAgent,
    setMobileScreen,
  ]);

  return { available: agent !== undefined, start };
}
