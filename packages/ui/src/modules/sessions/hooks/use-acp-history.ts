import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk/dist/acp.js";
import type {
  LoadSessionResponse,
  McpServer,
} from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { useCallback } from "react";

import { useStore } from "../../../store.js";
import type { Message } from "../../../types.js";
import { openConnection } from "../../acp/acp.js";
import { applyUpdate, finalizeAllStreaming } from "../../acp/session-projection.js";
import type { AcpUpdate, SessionConfigPayload } from "../../acp/types.js";
import { getSavedPreferences } from "../components/session-config-popover.js";

/**
 * Replay a session's history from the agent's runtime log into a fresh
 * `Message[]` via a throwaway WebSocket. Used at sidebar-click resume time
 * (initial load) and during reconnect (catching up events that landed while
 * we were offline).
 *
 * Why a throwaway socket? `loadSession` makes the runtime broadcast every
 * replayed update to the channel that called it. If we ran it on the live
 * WS, our streaming update handler would apply each replayed event on top
 * of the existing projection and double-render every message.
 *
 * **Caller contract:** the live WS (if any) must be closed before calling
 * `loadHistory`, for the same reason. This hook never touches the orchestrator's
 * live connection.
 *
 * Future: when agent-runtime grows an "events since cursor" API, the impl
 * here changes — `loadSession`+throwaway becomes a single SDK call with no
 * second WS — but the surface (`loadHistory(sid) → Message[]`) stays.
 */
export function useAcpHistory(
  selectedInstance: string | null,
  selectedMcpServers: McpServer[],
  captureSessionConfig: (response: SessionConfigPayload) => void,
  handleConfigUpdate: (update: AcpUpdate) => void,
): {
  loadHistory: (sid: string) => Promise<Message[]>;
} {
  const setSessionModes = useStore((s) => s.setSessionModes);
  const setSessionModels = useStore((s) => s.setSessionModels);

  const loadHistory = useCallback(async (sid: string): Promise<Message[]> => {
    if (!selectedInstance) return [];

    let replayed: Message[] = [];
    let ws: WebSocket | null = null;
    try {
      const conn = await openConnection(selectedInstance, (update) => {
        handleConfigUpdate(update);
        replayed = applyUpdate(replayed, update);
      });
      ws = conn.ws;
      await conn.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      const resp: LoadSessionResponse = await conn.connection.loadSession({
        sessionId: sid,
        cwd: ".",
        mcpServers: selectedMcpServers,
      });
      captureSessionConfig(resp);

      // Optimistic prefs nudge — real ACP `set*` calls fire when the
      // orchestrator opens the live channel via applySavedPreferences.
      const prefs = getSavedPreferences(selectedInstance);
      if (prefs.model && resp.models?.availableModels?.some((m) => m.modelId === prefs.model)) {
        setSessionModels({ ...resp.models, currentModelId: prefs.model });
      }
      if (prefs.mode && resp.modes?.availableModes?.some((m) => m.id === prefs.mode)) {
        setSessionModes({ ...resp.modes, currentModeId: prefs.mode });
      }
    } finally {
      ws?.close();
    }
    return finalizeAllStreaming(replayed);
  }, [selectedInstance, selectedMcpServers, captureSessionConfig, handleConfigUpdate, setSessionModes, setSessionModels]);

  return { loadHistory };
}
