import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { useAgent } from "../../agents/api/queries.js";
import { holds } from "../../agents/lib/agent-permissions.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { ChatView } from "./chat-view.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The chat route. A person who may not use an
 * Agent's sessions, such as an Agent Editor whose sessions permission is
 * taken away, never reaches its chat: a chat link to it opens the agent's
 * page instead. The redirect replaces the entry, so Back does not return to
 * the chat link and redirect again.
 */
export function ChatRoute() {
  const agentId = useStore((s) => s.selectedAgent);
  const agent = useAgent(agentId);
  const barred = agent !== null && !holds(agent.access, "sessions");

  useEffect(() => {
    if (!barred || !agentId) return;
    history.replaceState(
      null,
      "",
      routeToPath({ view: "sandbox-home", agentId, sandboxSection: "setup" }),
    );
    useStore.getState().hydrateRoute();
  }, [barred, agentId]);

  return barred ? null : <ChatView />;
}
