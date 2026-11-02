import { useEffect, useRef, useState } from "react";

import type { ConnectionState } from "./use-acp-connection.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether the chat's channel is lost, which is what the reconnect notice, the composer's reason and the chat's header badge say. One channel serves every session of an Agent, so the memory belongs to the Agent: a channel that drops stays lost across a move to another of its sessions, and only a live channel releases it, even while the connection state reads idle because the Agent is too far away to reconnect. A channel that has not opened yet is not lost, so a first connection never reads as a reconnect.
 */
export function useLostChannel(
  connectionState: ConnectionState,
  agentId: string | null,
  plannedResets: number,
): boolean {
  const [lost, setLost] = useState(false);
  const liveBefore = useRef(false);
  const agent = useRef(agentId);
  const resets = useRef(plannedResets);
  useEffect(() => {
    if (agent.current !== agentId || resets.current !== plannedResets) {
      agent.current = agentId;
      resets.current = plannedResets;
      liveBefore.current = false;
      setLost(false);
      return;
    }
    if (connectionState === "live") liveBefore.current = true;
    setLost(
      connectionState !== "live" &&
        (liveBefore.current ||
          connectionState === "reconnecting" ||
          connectionState === "reloading"),
    );
  }, [connectionState, agentId, plannedResets]);
  return lost;
}
