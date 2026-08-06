import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { useCallback, useRef } from "react";

import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import type { Attachment, Message } from "../../../types.js";
import { isConnectionClosed } from "../../acp/close-race.js";
import { extractErrorMessage } from "../../acp/errors.js";
import {
  finalizeAllStreaming,
  hasAgentContent,
  hasStreamingAssistant,
} from "../../acp/session-projection.js";
import { buildPromptBlocks } from "../../acp/utils.js";
import { acpSessionsKeys } from "../api/queries.js";
import { resolvePromptTarget } from "../lib/prompt-target.js";
import { classifySendOutcome } from "../lib/send-outcome.js";
import type { LiveSession } from "./use-acp-connection.js";

const DELIVERY_TIMEOUT_MS = 60_000;

export interface SendPromptOptions {
  /** Send the prompt to the agent without rendering a user bubble, and drop
   *  the turn silently if it fails before producing anything — so an auto-sent
   *  prompt reads as the agent speaking first rather than the user having
   *  typed a command. */
  hidden?: boolean;
}

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
 *     The send binds to the session it was dispatched for, never to whatever
 *     the view holds when the transport finally answers: navigation during the
 *     round trip repoints the shared connection, and following it would deliver
 *     the prompt into another conversation. `resolvePromptTarget` is that check,
 *     and a send it refuses fails visibly rather than silently.
 *
 *   - `stopAgent()` finalizes every streaming bubble locally so the UI
 *     reacts even if `cancel` hangs, then calls SDK cancel best-effort.
 *
 * `connectionRef` and `engagedSessionIdRef` come from the orchestrator's
 * connection layer; they will move into useAcpConnection in a later step.
 */
export function useAcpPrompt(
  selectedAgent: string | null,
  ensureConnection: () => Promise<LiveSession | null>,
  engagedSessionIdRef: React.MutableRefObject<string | null>,
  connectionRef: React.MutableRefObject<LiveConnection | null>,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
): {
  sendPrompt: (
    text: string,
    attachments?: Attachment[],
    opts?: SendPromptOptions,
  ) => Promise<void>;
  stopAgent: () => Promise<void>;
} {
  const setMessages = useStore((s) => s.setMessages);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendPrompt = useCallback(
    async (
      text: string,
      attachments?: Attachment[],
      opts?: SendPromptOptions,
    ) => {
      if (
        (!text && (!attachments || attachments.length === 0)) ||
        !selectedAgent
      )
        return;

      // Hidden sends (e.g. a KB's auto-run onboarding) still reach the agent
      // but render no user bubble, so the turn reads as the agent speaking
      // first. A hidden send that fails with nothing to show is dropped
      // silently rather than leaving an error the user never asked for.
      const hidden = opts?.hidden ?? false;

      // The session this send belongs to, captured before the first await.
      // `null` means "create one for me". A sidebar click during the round trip
      // repoints the shared connection at whatever session the user opened, and
      // this send must never follow it — see `resolvePromptTarget`.
      const intendedSessionId = useStore.getState().sessionId;

      const userParts: Message["parts"] = [];
      if (attachments?.length) for (const a of attachments) userParts.push(a);
      if (text) userParts.push({ kind: "text", text });

      const aId = crypto.randomUUID();
      const dropBubble = () =>
        setMessages((p) => p.filter((m) => m.id !== aId));
      const finalizeBubble = () =>
        setMessages((p) =>
          p.map((m) =>
            m.id === aId ? { ...m, streaming: false, queued: false } : m,
          ),
        );
      // Flips the moment the prompt frame is written to the socket. Everything
      // after that point survives losing the connection, so it decides whether
      // a close is a lost message or just this tab walking away.
      let delivered = false;

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
        ...(hidden ? [] : [uMsg]),
        aMsg,
      ]);

      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      watchdogRef.current = setTimeout(() => {
        const msgs = useStore.getState().messages;
        const bubble = msgs.find((m) => m.id === aId);
        // Not a part count: a verdict can land on a bubble the agent never wrote.
        if (bubble?.streaming && !hasAgentContent(bubble)) {
          if (hidden) {
            dropBubble();
          } else {
            setMessages((p) =>
              p.map((m) =>
                m.id === aId
                  ? {
                      ...m,
                      streaming: false,
                      queued: false,
                      error: {
                        message: "Couldn't deliver — the agent didn't respond.",
                        retryWith: { text, attachments },
                      },
                    }
                  : m,
              ),
            );
          }
        }
        watchdogRef.current = null;
      }, DELIVERY_TIMEOUT_MS);

      try {
        const live = await ensureConnection();
        if (!live) throw new Error("Failed to establish connection");

        // Guard before prompting, not after: delivering to the wrong session
        // appends the prompt to that conversation's log and has the agent answer
        // it there, with that conversation's context. Refusing to send is the
        // far cheaper failure.
        const target = resolvePromptTarget(intendedSessionId, live);
        if (!target.ok) throw new Error(target.reason);
        const sid = target.sessionId;
        const promptBlocks = await buildPromptBlocks(
          selectedAgent,
          sid,
          text,
          attachments,
        );
        // The SDK writes the frame into the socket on call and resolves only at
        // end of turn — so the prompt is delivered here, not on the await.
        const turn = live.connection.prompt({
          sessionId: sid,
          prompt: promptBlocks,
        });
        delivered = true;
        await turn;

        // Belt-and-braces: if platform_turn_ended somehow didn't fire (server
        // variant without our extension), force-close our bubble anyway.
        finalizeBubble();
      } catch (err: unknown) {
        const bubble = useStore.getState().messages.find((m) => m.id === aId);
        const streamed = !!bubble && hasAgentContent(bubble);
        const outcome = classifySendOutcome({
          connectionClosed: isConnectionClosed(err),
          delivered,
          queued: bubble?.queued ?? startingQueued,
          errorMessage: extractErrorMessage(err),
        });
        if (hidden && !streamed) {
          dropBubble();
        } else if (!outcome.report) {
          // Delivered, then the socket went away — leaving the session mid-turn
          // looks exactly like this. The turn runs on and replay brings the
          // reply back, so close the bubble and say nothing.
          finalizeBubble();
        } else if (!bubble) {
          // The user navigated away mid-send, so the projection no longer holds
          // the bubble this error belongs to. Writing it there would be a silent
          // no-op — and would take `retryWith`, the only remaining copy of the
          // text, down with it. Out-of-band or nothing.
          emitToast({ kind: "error", message: outcome.message });
        } else {
          // Whatever already streamed stays put — an interruption is not a
          // lost turn, and the error card renders below it. A hidden turn
          // keeps its content but still surfaces no error.
          const error = hidden
            ? undefined
            : { message: outcome.message, retryWith: { text, attachments } };
          setMessages((p) =>
            p.map((m) =>
              m.id === aId
                ? { ...m, streaming: false, queued: false, error }
                : m,
            ),
          );
        }
      } finally {
        if (watchdogRef.current) {
          clearTimeout(watchdogRef.current);
          watchdogRef.current = null;
        }
        queryClient.invalidateQueries({ queryKey: acpSessionsKeys.all });
        textareaRef.current?.focus();
      }
    },
    [selectedAgent, ensureConnection, setMessages, textareaRef],
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
