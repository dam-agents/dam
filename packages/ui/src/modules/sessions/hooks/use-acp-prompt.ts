import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { SessionMode } from "api-server-api";
import { useCallback, useEffect, useRef } from "react";

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
import type { UpdateHandler } from "../../acp/types.js";
import { buildPromptBlocks } from "../../acp/utils.js";
import { openFirstPromptChannel } from "../api/first-prompt-channel.js";
import { acpSessionsKeys, optimisticInsertSession } from "../api/queries.js";
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

/** The transport one send prompts on: a session id, the connection to reach it,
 *  and the two lifecycle moments a privately-owned connection needs. */
interface PromptChannel {
  connection: ClientSideConnection;
  sessionId: string;
  /** Decide what becomes of the channel now the prompt has been issued. */
  settle: () => Promise<void>;
  /** Release a channel this send owns — only safe once the turn it carried has
   *  settled, since that is the first proof the prompt was ever transmitted. */
  release: () => void;
  /** Whether `settle` found the chat had moved on and kept this channel private. */
  isDetached: () => boolean;
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
 *     A *first* prompt goes further and doesn't share the view's connection at
 *     all — `acquireChannel` gives it a private one that creates the session, so
 *     navigating away in the milliseconds that takes can neither repoint it nor
 *     close it. Once the prompt is on the wire the channel is either handed to
 *     the chat (still on that session) or closed (moved on), and the turn
 *     finishes server-side either way.
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
  adoptConnection: (
    connection: ClientSideConnection,
    ws: WebSocket,
    sessionId: string,
  ) => void,
  makeUpdateHandler: () => UpdateHandler,
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
  const setSessionId = useStore((s) => s.setSessionId);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Leaving the chat altogether (back to the sandbox list, another agent) empties
  // `sessionId` just like a blank chat does, so "no session open" alone can't
  // decide whether there is still a chat here to hand a connection to.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  /**
   * Get a connection and the session id to prompt on.
   *
   * Two shapes, because a first prompt and a follow-up have opposite needs. A
   * follow-up belongs to a session the view already holds, so it shares the live
   * connection and only has to check it wasn't repointed. A first prompt has no
   * session yet, so sharing is what kills it: it takes a private channel,
   * creates the session there, and calls `settle` once the frame is away to hand
   * that channel over or let it go.
   */
  const acquireChannel = useCallback(
    async (
      agentId: string,
      intendedSessionId: string | null,
    ): Promise<PromptChannel> => {
      if (intendedSessionId !== null) {
        const live = await ensureConnection();
        if (!live) throw new Error("Failed to establish connection");
        // Guard before prompting, not after: delivering to the wrong session
        // appends the prompt to that conversation's log and has the agent answer
        // it there, with that conversation's context. Refusing is far cheaper.
        const target = resolvePromptTarget(intendedSessionId, live);
        if (!target.ok) throw new Error(target.reason);
        return {
          connection: live.connection,
          sessionId: target.sessionId,
          settle: async () => {},
          // The chat's own connection — the connection hook owns its lifetime.
          release: () => {},
          isDetached: () => false,
        };
      }

      // Muted the moment this channel is let go, not merely when it closes: the
      // user can navigate away and straight back, and a still-draining socket
      // would then be a second channel applying the same session's updates
      // alongside the live one.
      let listening = true;
      let detached = false;
      const handler = makeUpdateHandler();
      const channel = await openFirstPromptChannel(agentId, (update, sid) => {
        if (listening) handler(update, sid);
      });
      return {
        connection: channel.connection,
        sessionId: channel.sessionId,
        settle: async () => {
          // The row appears only once the prompt is away: a session created but
          // never prompted is never written to disk, so listing it would leave a
          // ghost that the next poll silently reconciles away.
          optimisticInsertSession(agentId, channel.sessionId, SessionMode.Chat);
          if (!mountedRef.current || useStore.getState().sessionId !== null) {
            // The chat moved on. Mute the channel but leave it open: `prompt()`
            // only queues its frame on the SDK's stream, which reaches the
            // socket a microtask later, so closing now can drop the prompt
            // before it is ever transmitted. The turn settling is the first
            // acknowledgement the protocol gives us, and `release` waits for it.
            detached = true;
            listening = false;
            return;
          }
          adoptConnection(channel.connection, channel.ws, channel.sessionId);
          setSessionId(channel.sessionId);
        },
        release: () => {
          if (!detached) return;
          try {
            channel.ws.close();
          } catch {}
        },
        isDetached: () => detached,
      };
    },
    [ensureConnection, adoptConnection, makeUpdateHandler, setSessionId],
  );

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
      // Flips once the prompt has been handed to the SDK. Not proof it is on the
      // wire — the stream flushes a microtask later — but from here on the only
      // thing that can lose it is a connection dying, which is what this flag
      // lets the failure classifier reason about.
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

      let channel: PromptChannel | null = null;
      try {
        channel = await acquireChannel(selectedAgent, intendedSessionId);
        const sid = channel.sessionId;
        const promptBlocks = await buildPromptBlocks(
          selectedAgent,
          sid,
          text,
          attachments,
        );
        // The SDK writes the frame into the socket on call and resolves only at
        // end of turn — so the prompt is delivered here, not on the await.
        const turn = channel.connection.prompt({
          sessionId: sid,
          prompt: promptBlocks,
        });
        delivered = true;
        await channel.settle();
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
        // Safe here and nowhere earlier: the turn has settled, so the prompt
        // demonstrably reached the runtime.
        channel?.release();
        queryClient.invalidateQueries({ queryKey: acpSessionsKeys.all });
        // A detached turn ends minutes after the user moved on — pulling focus
        // into whatever they are reading now would be an ambush.
        if (!channel?.isDetached()) textareaRef.current?.focus();
      }
    },
    [selectedAgent, acquireChannel, setMessages, textareaRef],
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
