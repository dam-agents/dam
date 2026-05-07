import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { SessionMode } from "api-server-api";
import { useCallback, useRef } from "react";

import { api } from "../../../api.js";
import { invalidateAcrossTabs } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import type { Attachment, Message } from "../../../types.js";
import { addLocalPromptId } from "../../acp/local-prompt-ids.js";
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
 *     bubbles into the projection, ensures a live connection (so the agent's
 *     streaming response arrives over WS), and POSTs the prompt itself
 *     through the durable tRPC outbox. The optimistic user bubble is keyed
 *     on `promptId`; the wrapper later fans out a synthesized
 *     `user_message_chunk` with the same `_meta.promptId`, so the UI's
 *     projection merges instead of duplicating. The assistant bubble closes
 *     when the wrapper emits `platform_turn_ended`.
 *
 *   - `stopAgent()` finalizes every streaming bubble locally so the UI
 *     reacts immediately, then calls SDK cancel best-effort over the live
 *     WS. (Cancel still rides the WS — out of scope for the durable-prompt
 *     work; agent is still the one doing the cancellation.)
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
    // Caller-generated promptId: doubles as the durable-outbox idempotency
    // key (server-side dedupe within 1h) and as the user bubble's id. The
    // wrapper stamps the same id on its synthesized `user_message_chunk`'s
    // `_meta.promptId`. We register it as "rendered locally" so the
    // connection's update handler suppresses the wrapper's echo for *this*
    // tab — without that, mergeParts would concatenate the optimistic
    // text with the echo's text ("hi" → "hihi"). Other tabs have no
    // optimistic bubble and render the echo fresh.
    const promptId = crypto.randomUUID();
    addLocalPromptId(promptId);

    // If a prior turn is still streaming, this bubble starts `queued: true`
    // — the projection will promote it to active once prompt N's content
    // actually arrives. The user sees a "Waiting for previous prompt…"
    // indicator meanwhile.
    const startingQueued = hasStreamingAssistant(useStore.getState().messages);
    const uMsg: Message = { id: promptId, role: "user", parts: userParts, streaming: false };
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
      // Establish the live WS so streaming agent updates land here. The
      // prompt itself rides tRPC, but the response stream still arrives via
      // the engaged ACP channel.
      const conn = await ensureConnection();
      if (!conn) throw new Error("Failed to establish connection");

      const sid = engagedSessionIdRef.current;
      if (!sid) throw new Error("No active session");

      // Persist to the platform DB as soon as we know we have content for
      // this session — fire-and-forget, in parallel with the prompt
      // round-trip. Earlier this awaited the prompt's response before
      // persisting, so a user who navigated away mid-stream lost the
      // session from the sidebar entirely (the prompt promise rejected,
      // persist never ran). Persisting up front means: agent keeps
      // working, wrapper keeps logging, the session shows up in the
      // sidebar, and clicking back later loads the conversation.
      if (!persistedSessionsRef.current.has(sid)) {
        persistedSessionsRef.current.add(sid);
        api.sessions.create.mutate({ sessionId: sid, instanceId: selectedInstance, mode: SessionMode.Chat })
          .then(() => invalidateAcrossTabs([acpSessionsKeys.all]))
          .catch((err) => {
            // Allow a retry on the next prompt if persist failed.
            persistedSessionsRef.current.delete(sid);
            showToast({
              kind: "warning",
              message: `Session won't appear in the list: ${err instanceof Error ? err.message : "sync failed"}`,
            });
          });
      }

      const promptBlocks = await buildPromptBlocks(selectedInstance, sid, text, attachments);
      // Durable hand-off: server XADDs the envelope to `prompts:outbox`
      // and returns immediately. The forwarder ships it to the wrapper
      // async; agent updates stream back over the live WS that
      // `ensureConnection` set up.
      await api.prompts.send.mutate({
        instanceId: selectedInstance,
        sessionId: sid,
        prompt: promptBlocks,
        promptId,
      });
      addLog("queued", { promptId });
      // Don't manually finalize the assistant bubble: `platform_turn_ended`
      // (emitted by the wrapper on the agent's prompt response) closes it
      // via the projection.
    } catch (err: unknown) {
      const errMsg = extractErrorMessage(err);
      addLog("error", { message: errMsg });
      setMessages((p) => p.map((m) =>
        m.id === aId
          ? { ...m, streaming: false, queued: false, parts: [], error: { message: errMsg, retryWith: { text, attachments } } }
          : m,
      ));
    } finally {
      // Refresh the session list (locally + other tabs) so titles derived
      // from the conversation appear once the agent's first response lands.
      invalidateAcrossTabs([acpSessionsKeys.all]);
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
