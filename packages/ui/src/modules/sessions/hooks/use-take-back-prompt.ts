import { separateRendererBlocks } from "api-server-api";
import { useCallback, useRef } from "react";

import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { extractErrorMessage } from "../../acp/errors.js";
import { finalizeRunningReply } from "../../acp/session-projection.js";
import { removeQueuedPrompt } from "../api/acp-session-ops.js";
import { acpSessionsKeys } from "../api/keys.js";
import { draftKey } from "../lib/draft-key.js";
import {
  isRewriteBusy,
  isRewriteRefused,
  messageText,
} from "../lib/unanswered-prompt.js";
import type { LiveSession } from "./use-acp-connection.js";
import type { TakeBack } from "./use-take-back.js";

export function useTakeBackPrompt({
  selectedAgent,
  stopAgent,
  ensureLive,
  bindEngagement,
  reloadSession,
}: {
  selectedAgent: string | null;
  stopAgent: () => Promise<void>;
  ensureLive: () => Promise<LiveSession | null>;
  bindEngagement: (sessionId: string) => void;
  reloadSession: (sessionId: string) => Promise<void>;
}): (take: TakeBack) => Promise<void> {
  const setSessionId = useStore((s) => s.setSessionId);
  const setMessages = useStore((s) => s.setMessages);
  const pending = useRef(false);

  const takeBack = useCallback(
    async (take: TakeBack): Promise<void> => {
      const state = useStore.getState();
      const sid = state.sessionId;
      const at = state.messages.findIndex((m) => m.id === take.messageId);
      if (!selectedAgent || !sid || at === -1) return;
      const text = separateRendererBlocks(messageText(state.messages[at])).text;
      const reply = state.messages[at + 1];
      const promptId = reply?.promptId;
      const inView = () => useStore.getState().sessionId === sid;
      const typedBefore =
        useStore.getState().drafts[draftKey(selectedAgent, sid)]?.text ?? "";
      const restored =
        typedBefore.length > 0 ? `${text}\n\n${typedBefore}` : text;
      const restoreText = (sessionId: string) =>
        useStore
          .getState()
          .setDraft(draftKey(selectedAgent, sessionId), { text: restored });
      const takeBackLocally = () => {
        setMessages((prev) =>
          prev.filter((m) => m.id !== take.messageId && m.id !== reply?.id),
        );
        restoreText(sid);
      };
      const undoLocally = () => {
        const key = draftKey(selectedAgent, sid);
        if (useStore.getState().drafts[key]?.text === restored)
          useStore.getState().setDraft(key, { text: typedBefore });
        if (inView()) void reloadSession(sid);
      };

      const unqueued =
        promptId !== undefined &&
        state.queuedPrompts.some((q) => q.promptId === promptId) &&
        (await removeQueuedPrompt(selectedAgent, sid, promptId).then(
          () => true,
          () => false,
        ));
      if (unqueued) {
        if (inView()) takeBackLocally();
        else restoreText(sid);
        return;
      }
      if (take.upToMessageId === null) {
        await stopAgent();
        await state.discardSessionToDraft(sid, text);
        return;
      }

      useStore.getState().setTakingBack(sid);
      takeBackLocally();
      let result: { sessionId: string };
      try {
        await stopAgent();
        const live = await ensureLive();
        if (!live) throw new Error("the agent is not connected");
        result = await retryWhileRewriteBusy(
          () =>
            live.connection.agent.notify("session/cancel", { sessionId: sid }),
          () =>
            live.connection.agent.request("platform/rewriteFrom", {
              sessionId: sid,
              mode: "rewind",
              messageId: take.messageId,
              ...(take.upToMessageId !== undefined && {
                upToMessageId: take.upToMessageId,
              }),
              ...(take.title ? { title: take.title } : {}),
            }) as Promise<{ sessionId: string }>,
        );
      } catch (err) {
        useStore.getState().setTakingBack(null);
        undoLocally();
        throw err;
      }
      useStore.getState().setTakingBack(null);
      if (inView()) setMessages((prev) => finalizeRunningReply(prev));
      if (result.sessionId === sid) return;
      useStore
        .getState()
        .migrateDraft(
          draftKey(selectedAgent, sid),
          draftKey(selectedAgent, result.sessionId),
        );
      if (inView()) {
        bindEngagement(result.sessionId);
        setSessionId(result.sessionId);
      }
      void queryClient.invalidateQueries({
        queryKey: acpSessionsKeys.agent(selectedAgent),
      });
    },
    [
      selectedAgent,
      stopAgent,
      ensureLive,
      bindEngagement,
      reloadSession,
      setSessionId,
      setMessages,
    ],
  );

  return useCallback(
    async (take: TakeBack) => {
      if (pending.current) return;
      pending.current = true;
      try {
        await takeBack(take);
      } catch (err) {
        if (isRewriteRefused(err)) return;
        emitToast({
          kind: "error",
          message: `Couldn't take the message back: ${extractErrorMessage(err)}`,
        });
      } finally {
        pending.current = false;
      }
    },
    [takeBack],
  );
}

const REWRITE_BUSY_RETRY_MS = 250;
const REWRITE_BUSY_ATTEMPTS = 40;

async function retryWhileRewriteBusy<T>(
  stopTurn: () => Promise<void>,
  ask: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ask();
    } catch (err) {
      if (!isRewriteBusy(err) || attempt >= REWRITE_BUSY_ATTEMPTS) throw err;
      await stopTurn().catch(() => {});
      await new Promise((r) => setTimeout(r, REWRITE_BUSY_RETRY_MS));
    }
  }
}
