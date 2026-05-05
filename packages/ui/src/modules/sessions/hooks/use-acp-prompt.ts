import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { useCallback, useRef } from "react";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import type { Attachment, Message } from "../../../types.js";
import { finalizeAllStreaming, hasStreamingAssistant } from "../../acp/session-projection.js";
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
 *     orchestrator hands in), forwards the prompt over ACP, registers the
 *     session with the platform DB on first successful turn, and finalizes
 *     the assistant bubble.
 *
 *   - `stopAgent()` finalizes every streaming bubble locally so the UI
 *     reacts even if `cancel` hangs, then calls SDK cancel best-effort.
 *
 * The `persistedSessionsRef` dedup is local to this hook — only sendPrompt
 * reads it. `connectionRef` and `engagedSessionIdRef` come from the
 * orchestrator's connection layer; they will move into useAcpConnection
 * in a later step.
 */
export function useAcpPrompt(
  selectedInstance: string | null,
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
  const showToast = useStore((s) => s.showToast);

  // Sessions already upserted to the platform DB. Lazy upsert (only after
  // the first successful prompt) prevents empty rows in the sidebar when
  // the user opens the app and closes it without sending anything.
  const persistedSessionsRef = useRef<Set<string>>(new Set());

  const sendPrompt = useCallback(async (text: string, attachments?: Attachment[]) => {
    if ((!text && (!attachments || attachments.length === 0)) || !selectedInstance) return;

    const userParts: Message["parts"] = [];
    if (attachments?.length) for (const a of attachments) userParts.push(a);
    if (text) userParts.push({ kind: "text", text });

    const aId = crypto.randomUUID();

    // If a prior turn is still streaming, this bubble starts `queued: true`
    // — the projection will promote it to active once prompt N's content
    // actually arrives. The user sees a "Waiting for previous prompt…"
    // indicator meanwhile.
    const startingQueued = hasStreamingAssistant(useStore.getState().messages);
    const uMsg: Message = { id: crypto.randomUUID(), role: "user", parts: userParts, streaming: false };
    const aMsg: Message = { id: aId, role: "assistant", parts: [], streaming: true, queued: startingQueued };
    // Drop Retry buttons on any prior failed send — only the latest failure
    // should offer a retry. The error text itself stays for history.
    setMessages((p) => [
      ...p.map((m) => (m.error?.retryWith ? { ...m, error: { message: m.error.message } } : m)),
      uMsg,
      aMsg,
    ]);
    addLog("prompt", { text });

    try {
      const conn = await ensureConnection();
      if (!conn) throw new Error("Failed to establish connection");

      const sid = engagedSessionIdRef.current;
      if (!sid) throw new Error("No active session");
      const promptBlocks = await buildPromptBlocks(selectedInstance, sid, text, attachments);
      const r = await conn.prompt({ sessionId: sid, prompt: promptBlocks });
      addLog("done", { stopReason: r.stopReason });

      // Persist to the platform DB lazily, only once the session has real
      // content. Await the create before invalidating the session-list
      // query — otherwise the refetch races the server's DB write, sees no
      // row for this session, and the user has to hit Refresh for it to
      // appear.
      if (!persistedSessionsRef.current.has(sid)) {
        persistedSessionsRef.current.add(sid);
        try {
          await api.sessions.create.mutate({ sessionId: sid, instanceId: selectedInstance });
        } catch (err) {
          showToast({
            kind: "warning",
            message: `Session won't appear in the list: ${err instanceof Error ? err.message : "sync failed"}`,
          });
        }
      }
      // Belt-and-braces: if platform_turn_ended somehow didn't fire (server
      // variant without our extension), force-close our bubble anyway.
      setMessages((p) => p.map((m) => m.id === aId ? { ...m, streaming: false, queued: false } : m));
    } catch (err: unknown) {
      const errMsg = extractErrorMessage(err);
      addLog("error", { message: errMsg });
      setMessages((p) => p.map((m) =>
        m.id === aId
          ? { ...m, streaming: false, queued: false, parts: [], error: { message: errMsg, retryWith: { text, attachments } } }
          : m,
      ));
    } finally {
      queryClient.invalidateQueries({ queryKey: acpSessionsKeys.all });
      textareaRef.current?.focus();
    }
  }, [selectedInstance, ensureConnection, engagedSessionIdRef, addLog, setMessages, showToast, textareaRef]);

  const stopAgent = useCallback(async () => {
    const conn = connectionRef.current?.connection;
    const sid = engagedSessionIdRef.current;
    // Finalize up front so the UI reacts immediately even if `cancel` hangs
    // or the SDK never rejects on a dropped stream.
    setMessages((p) => finalizeAllStreaming(p));
    if (!conn || !sid) return;
    try { await conn.cancel({ sessionId: sid }); } catch {}
  }, [engagedSessionIdRef, connectionRef, setMessages]);

  return { sendPrompt, stopAgent };
}
