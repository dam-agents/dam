import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { useCallback } from "react";

import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import type { Attachment, Message } from "../../../types.js";
import {
  finalizeAllStreaming,
  hasStreamingAssistant,
} from "../../acp/session-projection.js";
import { buildPromptBlocks, extractErrorMessage } from "../../acp/utils.js";
import { acpSessionsKeys } from "../api/queries.js";

interface LiveConnection {
  connection: ClientSideConnection;
  ws: WebSocket;
}

/**
 * Owns the user-driven prompt + cancel actions:
 *
 *   - `sendPrompt(text, attachments)` writes optimistic user + assistant
 *     bubbles into the projection, ensures a live connection (which the
 *     orchestrator hands in), forwards the prompt over ACP, and finalizes
 *     the assistant bubble. Session persistence to the platform DB happens
 *     eagerly inside the engagement hook, so a refresh mid-turn still
 *     leaves the session in the sidebar.
 *
 *   - `stopAgent()` finalizes every streaming bubble locally so the UI
 *     reacts even if `cancel` hangs, then calls SDK cancel best-effort.
 *
 * `connectionRef` and `engagedSessionIdRef` come from the orchestrator's
 * connection layer; they will move into useAcpConnection in a later step.
 */
export function useAcpPrompt(
  selectedAgent: string | null,
  ensureConnection: () => Promise<ClientSideConnection | null>,
  engagedSessionIdRef: React.MutableRefObject<string | null>,
  connectionRef: React.MutableRefObject<LiveConnection | null>,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
): {
  sendPrompt: (text: string, attachments?: Attachment[]) => Promise<void>;
  stopAgent: () => Promise<void>;
} {
  const setMessages = useStore((s) => s.setMessages);
  const addLog = useStore((s) => s.addLog);

  const sendPrompt = useCallback(
    async (text: string, attachments?: Attachment[]) => {
      if (
        (!text && (!attachments || attachments.length === 0)) ||
        !selectedAgent
      )
        return;

      const userParts: Message["parts"] = [];
      if (attachments?.length) for (const a of attachments) userParts.push(a);
      if (text) userParts.push({ kind: "text", text });

      const aId = crypto.randomUUID();

      // If a prior turn is still streaming, this bubble starts `queued: true`
      // — the projection will promote it to active once prompt N's content
      // actually arrives. The user sees a "Waiting for previous prompt…"
      // indicator meanwhile.
      const startingQueued = hasStreamingAssistant(
        useStore.getState().messages,
      );
      const uMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        parts: userParts,
        streaming: false,
      };
      const aMsg: Message = {
        id: aId,
        role: "assistant",
        parts: [],
        streaming: true,
        queued: startingQueued,
      };
      // Drop Retry buttons on any prior failed send — only the latest failure
      // should offer a retry. The error text itself stays for history.
      setMessages((p) => [
        ...p.map((m) =>
          m.error?.retryWith
            ? { ...m, error: { message: m.error.message } }
            : m,
        ),
        uMsg,
        aMsg,
      ]);
      addLog("prompt", { text });

      try {
        const conn = await ensureConnection();
        if (!conn) throw new Error("Failed to establish connection");

        const sid = engagedSessionIdRef.current;
        if (!sid) throw new Error("No active session");
        const promptBlocks = await buildPromptBlocks(
          selectedAgent,
          sid,
          text,
          attachments,
        );
        const r = await conn.prompt({ sessionId: sid, prompt: promptBlocks });
        addLog("done", { stopReason: r.stopReason });

        // Belt-and-braces: if platform_turn_ended somehow didn't fire (server
        // variant without our extension), force-close our bubble anyway.
        setMessages((p) =>
          p.map((m) =>
            m.id === aId ? { ...m, streaming: false, queued: false } : m,
          ),
        );
      } catch (err: unknown) {
        const errMsg = extractErrorMessage(err);
        addLog("error", { message: errMsg });
        setMessages((p) =>
          p.map((m) =>
            m.id === aId
              ? {
                  ...m,
                  streaming: false,
                  queued: false,
                  parts: [],
                  error: { message: errMsg, retryWith: { text, attachments } },
                }
              : m,
          ),
        );
      } finally {
        queryClient.invalidateQueries({ queryKey: acpSessionsKeys.all });
        textareaRef.current?.focus();
      }
    },
    [
      selectedAgent,
      ensureConnection,
      engagedSessionIdRef,
      addLog,
      setMessages,
      textareaRef,
    ],
  );

  const stopAgent = useCallback(async () => {
    const conn = connectionRef.current?.connection;
    const sid = engagedSessionIdRef.current;
    // Finalize up front so the UI reacts immediately even if `cancel` hangs
    // or the SDK never rejects on a dropped stream.
    setMessages((p) => finalizeAllStreaming(p));
    if (!conn || !sid) return;
    try {
      await conn.cancel({ sessionId: sid });
    } catch {}
  }, [engagedSessionIdRef, connectionRef, setMessages]);

  return { sendPrompt, stopAgent };
}
