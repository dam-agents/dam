import { useEffect, useRef, useState } from "react";

import type { ConnectionState } from "./use-acp-connection.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether the chat's channel is lost, which is what the reconnect notice, the composer's reason and the chat's header badge say. A channel that drops stays lost until it is live again, even while the connection state reads idle because the Agent is too far away to reconnect; a channel that has not opened yet in this chat is not lost, so a first connection never reads as a reconnect.
 */
export function useLostChannel(
  connectionState: ConnectionState,
  chatKey: string,
): boolean {
  const [lost, setLost] = useState(false);
  const liveBefore = useRef(false);
  const key = useRef(chatKey);
  useEffect(() => {
    if (key.current !== chatKey) {
      key.current = chatKey;
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
  }, [connectionState, chatKey]);
  return lost;
}
