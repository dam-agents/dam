import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type { PromptBlock } from "api-server-api";
import { SessionMode } from "api-server-api";
import { useCallback, useEffect, useRef } from "react";

import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import type { Attachment, Message, RetryPayload } from "../../../types.js";
import {
  connectionCloseReason,
  isConnectionClosed,
} from "../../acp/close-race.js";
import { extractErrorMessage, isQueueFullError } from "../../acp/errors.js";
import {
  finalizeAllStreaming,
  hasAgentContent,
  hasStreamingAssistant,
} from "../../acp/session-projection.js";
import { buildPromptBlocks } from "../../acp/utils.js";
import { acpSessionsKeys, optimisticInsertSession } from "../api/queries.js";
import { draftKey } from "../lib/draft-key.js";
import { resolvePromptTarget } from "../lib/prompt-target.js";
import { classifySendOutcome } from "../lib/send-outcome.js";
import {
  forgetUndelivered,
  rememberUndelivered,
  undeliveredRecordOf,
} from "../lib/undelivered-store.js";
import type {
  LiveConnection,
  LiveSession,
  StartedSession,
} from "./use-acp-connection.js";
import type { PromptDelivery } from "./use-prompt-delivery.js";

export type PromptInitiator = "user" | "system";

export interface SendPromptOptions {
  hidden?: boolean;
  initiator?: PromptInitiator;
  retryOf?: string;
  blocks?: PromptBlock[];
}

export interface UseAcpPromptOptions {
  selectedAgent: string | null;
  ensureConnection: () => Promise<LiveSession | null>;
  beginSession: () => Promise<StartedSession>;
  engagedSessionIdRef: React.MutableRefObject<string | null>;
  connectionRef: React.MutableRefObject<LiveConnection | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  delivery: PromptDelivery;
}

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
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const startedRef = useRef<StartedSession | null>(null);

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
      const empty =
        !text &&
        (attachments?.length ?? 0) === 0 &&
        (sendOpts?.blocks?.length ?? 0) === 0;
      if (empty || !selectedAgent) return;

      const hidden = sendOpts?.hidden ?? false;
      const initiator = sendOpts?.initiator;
      const retryOf = sendOpts?.retryOf;
      const resendBlocks = sendOpts?.blocks;
      const retryPayload: RetryPayload = {
        text,
        ...(attachments ? { attachments } : {}),
        ...(resendBlocks && resendBlocks.length > 0
          ? { blocks: resendBlocks }
          : {}),
      };

      const intendedSessionId = useStore.getState().sessionId;

      const userParts: Message["parts"] = [];
      for (const block of sendOpts?.blocks ?? []) {
        if (block.type === "image")
          userParts.push({
            kind: "image",
            data: block.data,
            mimeType: block.mimeType,
          });
        else if (block.type === "resource_link")
          userParts.push({
            kind: "file",
            name: block.name,
            mimeType: block.mimeType ?? "",
          });
      }
      if (attachments?.length) for (const a of attachments) userParts.push(a);
      if (text) userParts.push({ kind: "text", text });

      const aId = crypto.randomUUID();
      const promptId = crypto.randomUUID();
      const uId = promptId;
      let reported = false;
      const dropBubble = () =>
        setMessages((p) => p.filter((m) => m.id !== aId));
      const failUserMessage = (message: string) => {
        if (reported) return;
        reported = true;
        if (!hidden) {
          rememberUndelivered(
            draftKey(selectedAgent, intendedSessionId),
            undeliveredRecordOf({
              id: uId,
              text,
              ...(attachments ? { attachments } : {}),
              ...(resendBlocks && resendBlocks.length > 0
                ? { blocks: resendBlocks }
                : {}),
              reason: message,
              recordedAt: new Date().toISOString(),
            }),
          );
        }
        setMessages((p) =>
          p.flatMap<Message>((m) => {
            if (m.id === aId) return [];
            if (m.id !== uId) return [m];
            return [{ ...m, error: { message, retryWith: retryPayload } }];
          }),
        );
      };
      const interruptTurn = (message: string) => {
        if (reported) return;
        reported = true;
        setMessages((p) =>
          p.map((m) =>
            m.id === aId
              ? {
                  ...m,
                  streaming: false,
                  queued: false,
                  error: { message, retryWith: retryPayload },
                }
              : m,
          ),
        );
      };
      const finalizeBubble = () =>
        setMessages((p) =>
          p.map((m) =>
            m.id === aId ? { ...m, streaming: false, queued: false } : m,
          ),
        );
      let delivered = false;

      const startingQueued = hasStreamingAssistant(
        useStore.getState().messages,
      );
      const uMsg: Message = {
        id: uId,
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
        ...(hidden ? {} : { retryWith: retryPayload }),
      };
      if (retryOf !== undefined) {
        forgetUndelivered(draftKey(selectedAgent, intendedSessionId), retryOf);
      }
      setMessages((p) => [
        ...p.filter((m) => m.id !== retryOf),
        ...(hidden ? [] : [uMsg]),
        aMsg,
      ]);

      const failDelivery = () => {
        const bubble = useStore.getState().messages.find((m) => m.id === aId);
        if (!bubble?.streaming || hasAgentContent(bubble)) return;
        if (hidden) {
          dropBubble();
          return;
        }
        failUserMessage(
          "Not delivered — the agent never confirmed it received this message.",
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
          const target = resolvePromptTarget(intendedSessionId, live.sessionId);
          if (!target.ok) throw new Error(target.reason);
          ({ connection, isOpen } = live);
          sessionId = target.sessionId;
        } else {
          started = await beginSession();
          startedRef.current = started;
          ({ connection, sessionId, isOpen } = started);
        }

        const promptBlocks =
          resendBlocks && resendBlocks.length > 0
            ? resendBlocks
            : await buildPromptBlocks(
                selectedAgent,
                sessionId,
                text,
                attachments,
              );
        const turn = connection.prompt({
          sessionId,
          prompt: promptBlocks,
          _meta: {
            platform: {
              promptId,
              surface: "ui",
              ...(retryOf !== undefined ? { retryOf } : {}),
              ...(initiator ? { initiator } : {}),
            },
          },
        });
        delivered = isOpen();

        if (started) {
          if (delivered) {
            optimisticInsertSession(selectedAgent, sessionId, SessionMode.Chat);
          }
          detached = !started.settle(canKeepConnection(selectedAgent, aId));
          if (detached) startedRef.current = null;
        }
        await turn;

        finalizeBubble();
      } catch (err: unknown) {
        const bubble = useStore.getState().messages.find((m) => m.id === aId);
        const streamed = !!bubble && hasAgentContent(bubble);
        const outcome = classifySendOutcome({
          connectionClosed: isConnectionClosed(err),
          delivered,
          queued: bubble?.queued ?? startingQueued,
          queueFull: isQueueFullError(err),
          closeReason: connectionCloseReason(err),
          errorMessage: extractErrorMessage(err),
        });
        if (hidden && !streamed) {
          dropBubble();
        } else if (!outcome.report) {
          finalizeBubble();
        } else if (!bubble) {
          if (!detached) {
            emitToast({ kind: "error", message: outcome.message });
          }
        } else if (hidden) {
          dropBubble();
        } else if (streamed) {
          interruptTurn(outcome.message);
        } else {
          failUserMessage(outcome.message);
        }
      } finally {
        delivery.endSend(promptId);
        if (startedRef.current === started) startedRef.current = null;
        started?.finish();
        queryClient.invalidateQueries({ queryKey: acpSessionsKeys.all });
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
    setMessages((p) => finalizeAllStreaming(p));
    if (!conn || !sid) return;
    try {
      await conn.cancel({ sessionId: sid });
    } catch {}
  }, [engagedSessionIdRef, connectionRef, setMessages]);

  return { sendPrompt, stopAgent };
}
