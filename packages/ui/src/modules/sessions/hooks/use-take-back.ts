import type { QueuedPrompt } from "api-server-api";
import { useEffect, useRef } from "react";

import type { Message } from "../../../types.js";
import { unansweredPrompt } from "../lib/unanswered-prompt.js";

export interface TakeBack {
  messageId: string;
  upToMessageId: string | null | undefined;
  title: string | null;
}

export function useTakeBack({
  shown,
  rewritePoints,
  sessionId,
  rewritable,
  harnessForks,
  queuedPrompts,
  title,
  takeBackPrompt,
  stop,
}: {
  shown: Message[];
  rewritePoints: Map<string, string | null | undefined>;
  sessionId: string | null;
  rewritable: boolean;
  harnessForks: boolean;
  queuedPrompts: readonly QueuedPrompt[];
  title: string | null;
  takeBackPrompt: (take: TakeBack) => Promise<void>;
  stop: () => void;
}): (() => void) | null {
  const unanswered = unansweredPrompt(shown);
  const upTo = unanswered ? rewritePoints.get(unanswered.id) : undefined;
  const replyPromptId = unanswered ? shown[shown.length - 1].promptId : null;
  const queueClear = queuedPrompts.every(
    (q) => q.promptId !== null && q.promptId === replyPromptId,
  );
  const ready =
    unanswered !== null &&
    sessionId !== null &&
    queueClear &&
    rewritable &&
    (upTo === null || harnessForks);
  const messageId = unanswered?.id ?? null;
  const awaitingSession = useRef<string | null>(null);

  useEffect(() => {
    if (awaitingSession.current === null) return;
    if (awaitingSession.current !== messageId) {
      awaitingSession.current = null;
      stop();
      return;
    }
    if (!ready) return;
    awaitingSession.current = null;
    void takeBackPrompt({ messageId, upToMessageId: upTo, title });
  }, [ready, messageId, upTo, title, takeBackPrompt, stop]);

  if (messageId === null) return null;
  if (sessionId === null)
    return () => {
      awaitingSession.current = messageId;
    };
  if (!ready) return null;
  return () => void takeBackPrompt({ messageId, upToMessageId: upTo, title });
}
