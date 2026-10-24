import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { useSharedAgents } from "../../agents/api/queries.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { ChatView } from "./chat-view.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The chat route, which an Agent Editor never
 * reaches for a Shared Agent: an editor has no sessions with it, so a chat
 * link to it opens the agent's page instead. The redirect replaces the entry,
 * so Back does not return to the chat link and redirect again.
 */
export function ChatRoute() {
  const agentId = useStore((s) => s.selectedAgent);
  const shared = useSharedAgents().some((a) => a.id === agentId);

  useEffect(() => {
    if (!shared || !agentId) return;
    history.replaceState(
      null,
      "",
      routeToPath({ view: "sandbox-home", agentId, sandboxSection: "setup" }),
    );
    useStore.getState().hydrateRoute();
  }, [shared, agentId]);

  return shared ? null : <ChatView />;
}
