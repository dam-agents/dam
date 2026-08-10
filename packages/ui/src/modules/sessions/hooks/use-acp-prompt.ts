import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { SessionMode } from "api-server-api";
import { useCallback, useEffect, useRef } from "react";

import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import type { Attachment, Message } from "../../../types.js";
import {
  connectionCloseReason,
  isConnectionClosed,
} from "../../acp/close-race.js";
import {
  extractErrorMessage,
  isMissingSessionError,
} from "../../acp/errors.js";
import {
  finalizeAllStreaming,
  hasAgentContent,
  hasStreamingAssistant,
} from "../../acp/session-projection.js";
import { buildPromptBlocks } from "../../acp/utils.js";
import { acpSessionsKeys, optimisticInsertSession } from "../api/queries.js";
import { resolvePromptTarget } from "../lib/prompt-target.js";
import { classifySendOutcome } from "../lib/send-outcome.js";
import type {
  LiveConnection,
  LiveSession,
  StartedSession,
} from "./use-acp-connection.js";
import type { PromptDelivery } from "./use-prompt-delivery.js";

export interface SendPromptOptions {
  /** Send the prompt to the agent without rendering a user bubble, and drop
   *  the turn silently if it fails before producing anything — so an auto-sent
   *  prompt reads as the agent speaking first rather than the user having
   *  typed a command. */
  hidden?: boolean;
}

export interface UseAcpPromptOptions {
  selectedAgent: string | null;
  /** The chat's live connection, for a session the view already holds. */
  ensureConnection: () => Promise<LiveSession | null>;
  /** A private connection carrying its own new session, for a first prompt. */
  beginSession: () => Promise<StartedSession>;
  engagedSessionIdRef: React.MutableRefObject<string | null>;
  connectionRef: React.MutableRefObject<LiveConnection | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  delivery: PromptDelivery;
}

/**
 * Owns the user-driven prompt + cancel actions:
 *
 *   - `sendPrompt(text, attachments)` writes optimistic user + assistant
 *     bubbles into the projection, gets a connection and a session to prompt on,
 *     forwards the prompt over ACP, and finalizes the assistant bubble.
 *
 *     A send binds to the session it was dispatched for, never to whatever the
 *     view holds once the transport answers — `resolvePromptTarget` enforces
 *     that, and a first prompt goes further by taking a connection of its own
 *     (`beginSession`) that navigation cannot close or repoint.
 *
 *   - `stopAgent()` finalizes every streaming bubble locally so the UI
 *     reacts even if `cancel` hangs, then calls SDK cancel best-effort.
 *
 * Delivery feedback is not decided here: each send stamps a `promptId` the
 * runtime echoes back on `platform/promptAccepted` / `platform/promptStarted`,
 * and `delivery` (from `usePromptDelivery`) owns the deadlines those frames
 * arm and disarm. This hook only supplies the per-prompt failure callback,
 * because it owns the bubble.
 */
export function useAcpPrompt(opts: UseAcpPromptOptions): {
  sendPrompt: (
    text: string,
    attachments?: Attachment[],
    opts?: SendPromptOptions,
  ) => Promise<void>;
  stopAgent: () => Promise<void>;
} {
  const {
    selectedAgent,
    ensureConnection,
    beginSession,
    engagedSessionIdRef,
    connectionRef,
    textareaRef,
    delivery,
  } = opts;
  const setMessages = useStore((s) => s.setMessages);
  // Assigned on mount, not only cleared: StrictMode runs setup → cleanup → setup
  // on one fiber, so a cleared-only ref stays false for the whole life in dev.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // What Stop cancels on while a first prompt's channel is still private. Cleared
  // once the channel is given up — a turn the user walked away from isn't theirs
  // to cancel from another chat.
  const startedRef = useRef<StartedSession | null>(null);

  /** Whether the chat that dispatched this send is still the one on screen — its
   *  own bubble surviving in the projection is the marker. */
  const viewerStillHere = useCallback(
    (agentId: string, bubbleId: string): boolean => {
      if (!mountedRef.current) return false;
      const state = useStore.getState();
      return (
        state.selectedAgent === agentId &&
        state.messages.some((m) => m.id === bubbleId)
      );
    },
    [],
  );

  /** Whether that chat can also take over the session's connection: it has to
   *  still be the blank chat, and not showing a terminal. */
  const canKeepConnection = useCallback(
    (agentId: string, bubbleId: string): boolean => {
      const state = useStore.getState();
      return (
        viewerStillHere(agentId, bubbleId) &&
        state.sessionId === null &&
        state.sessionMode !== SessionMode.Terminal
      );
    },
    [viewerStillHere],
  );

  const sendPrompt = useCallback(
    async (
      text: string,
      attachments?: Attachment[],
      sendOpts?: SendPromptOptions,
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
      const hidden = sendOpts?.hidden ?? false;

      // Captured before the first await, since a sidebar click during the round
      // trip moves the view. `null` means "create one for me".
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
      // True once the prompt reached an open socket — as close to an
      // acknowledgement as the protocol offers.
      let delivered = false;

      // Only a fallback for the error copy when the bubble is gone: whether the
      // prompt is actually parked behind a running turn is the server's call
      // (`promptAccepted`), not a guess from local streaming state — guessing
      // is what made #829 lie after a mid-turn reload dropped that state.
      const startingQueued = hasStreamingAssistant(
        useStore.getState().messages,
      );
      // Travels in `session/prompt`'s `_meta.platform` and comes back on the
      // runtime's delivery notifications, which is what keys them to this
      // bubble.
      const promptId = crypto.randomUUID();
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
        promptId,
        // Stashed on the bubble, not just captured here: the connection dying
        // under a queued prompt fails it from the WS close handler, which has
        // no access to this closure. Hidden sends carry none — they never offer
        // a retry.
        ...(hidden ? {} : { retryWith: { text, attachments } }),
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

      // Shared by both delivery deadlines. Agent content having arrived (or
      // the bubble having closed) makes it a no-op, so a deadline that fires
      // after the prompt succeeded can't retract a good turn. Not a part
      // count: a verdict can land on a bubble the agent never wrote.
      const failDelivery = () => {
        const bubble = useStore.getState().messages.find((m) => m.id === aId);
        if (!bubble?.streaming || hasAgentContent(bubble)) return;
        if (hidden) {
          dropBubble();
          return;
        }
        setMessages((p) =>
          p.map((m) =>
            m.id === aId
              ? {
                  ...m,
                  streaming: false,
                  queued: false,
                  error: {
                    message:
                      "Couldn't deliver — the agent never confirmed it received this message.",
                    retryWith: m.retryWith,
                  },
                }
              : m,
          ),
        );
      };
      delivery.beginSend(promptId, failDelivery);

      let started: StartedSession | null = null;
      let detached = false;
      try {
        let connection: ClientSideConnection;
        let sessionId: string;
        let isOpen: () => boolean;

        if (intendedSessionId !== null) {
          const live = await ensureConnection();
          if (!live) throw new Error("Failed to establish connection");
          // Before prompting, not after — a misdelivery is written to the other
          // conversation's log and answered there.
          const target = resolvePromptTarget(intendedSessionId, live.sessionId);
          if (!target.ok) throw new Error(target.reason);
          ({ connection, isOpen } = live);
          sessionId = target.sessionId;
        } else {
          started = await beginSession();
          startedRef.current = started;
          ({ connection, sessionId, isOpen } = started);
        }

        const promptBlocks = await buildPromptBlocks(
          selectedAgent,
          sessionId,
          text,
          attachments,
        );
        // Resolves at end of turn, so the send is issued here, not on the await.
        const turn = connection.prompt({
          sessionId,
          prompt: promptBlocks,
          // `surface` tells the runtime a person is typing here rather than a
          // messenger relaying a thread — a session continued from a channel
          // is otherwise answered under that channel's reply contract.
          _meta: { platform: { promptId, surface: "ui" } },
        });
        // A browser discards a send on a closing socket without telling anyone,
        // so an open socket is as close to delivery as the client can observe.
        delivered = isOpen();

        if (started) {
          // An unprompted session is never listed, so a row for one is a ghost.
          if (delivered) {
            optimisticInsertSession(selectedAgent, sessionId, SessionMode.Chat);
          }
          detached = !started.settle(canKeepConnection(selectedAgent, aId));
          if (detached) startedRef.current = null;
        }
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
          sessionMissing: isMissingSessionError(err),
          closeReason: connectionCloseReason(err),
          errorMessage: extractErrorMessage(err),
        });
        if (hidden && !streamed) {
          dropBubble();
        } else if (!outcome.report) {
          // Delivered, then the socket went away — what leaving a session
          // mid-turn looks like. The turn runs on and replay brings the reply
          // back, so close the bubble and say nothing.
          finalizeBubble();
        } else if (!bubble) {
          // A session switch wiped the bubble this error belongs to, so writing
          // it there would be a silent no-op. A detached turn's failure stays in
          // its own session's log rather than ambushing whatever is on screen.
          if (!detached) {
            emitToast({ kind: "error", message: outcome.message });
          }
        } else if (!bubble.error) {
          // Unless the bubble already carries a failure. Losing the connection
          // rejects this call with a connection-closed error *and* runs the WS
          // close handler, which reports the far more specific "dropped from
          // the queue" — don't overwrite it with the generic wording.
          //
          // Whatever already streamed stays put — an interruption is not a
          // lost turn, and the error card renders below it. A hidden turn
          // keeps its content but still surfaces no error.
          setMessages((p) =>
            p.map((m) =>
              m.id === aId
                ? {
                    ...m,
                    streaming: false,
                    queued: false,
                    error: hidden
                      ? undefined
                      : {
                          message: outcome.message,
                          ...(outcome.retry ? { retryWith: m.retryWith } : {}),
                        },
                  }
                : m,
            ),
          );
        }
      } finally {
        // The turn has settled, so whichever deadline is still pending for
        // this prompt has nothing left to guard.
        delivery.endSend(promptId);
        if (startedRef.current === started) startedRef.current = null;
        // Only here: the turn has settled, so nothing of ours is still queued on
        // that socket.
        started?.finish();
        queryClient.invalidateQueries({ queryKey: acpSessionsKeys.all });
        // Checked now, not earlier: a turn can end long after the user moved on.
        if (viewerStillHere(selectedAgent, aId)) textareaRef.current?.focus();
      }
    },
    [
      selectedAgent,
      ensureConnection,
      beginSession,
      canKeepConnection,
      viewerStillHere,
      setMessages,
      textareaRef,
      delivery,
    ],
  );

  const stopAgent = useCallback(async () => {
    const started = startedRef.current;
    const conn = connectionRef.current?.connection ?? started?.connection;
    const sid = engagedSessionIdRef.current ?? started?.sessionId;
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
