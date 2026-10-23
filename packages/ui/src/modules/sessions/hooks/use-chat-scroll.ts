import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { Message } from "../../../types.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the transcript's scroll engine. It follows a
 * growing reply while the person is at the bottom, offers the jump button once
 * they are not, and keeps the reading position when older messages are paged in
 * above. It knows nothing about sessions or prompts.
 */
export function useChatScroll({
  messages,
  sessionId,
  loadingSession,
  loadOlderMessages,
}: {
  messages: Message[];
  sessionId: string | null;
  loadingSession: boolean;
  loadOlderMessages: (before: string) => Promise<"paged" | "reloaded" | "noop">;
}) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    stickRef.current = true;
    setShowJump(false);
    el.scrollTop = el.scrollHeight;
  }, []);

  const pendingPrependRef = useRef<{
    height: number;
    before: string;
  } | null>(null);

  const loadOlderKeepingScroll = useCallback(
    async (before: string): Promise<"paged" | "reloaded" | "noop"> => {
      const el = messagesRef.current;
      if (el) {
        pendingPrependRef.current = { height: el.scrollHeight, before };
        el.style.overflowAnchor = "none";
      }
      const outcome = await loadOlderMessages(before);
      if (outcome !== "paged") {
        pendingPrependRef.current = null;
        if (el) el.style.overflowAnchor = "";
        if (outcome === "reloaded") scrollToBottom();
      }
      return outcome;
    },
    [loadOlderMessages, scrollToBottom],
  );

  useLayoutEffect(() => {
    const pending = pendingPrependRef.current;
    const el = messagesRef.current;
    if (!pending || !el) return;
    if (messages.some((m) => m.loadOlderBefore === pending.before)) {
      pending.height = el.scrollHeight;
      return;
    }
    pendingPrependRef.current = null;
    el.scrollTop += el.scrollHeight - pending.height;
    el.style.overflowAnchor = "";
  }, [messages]);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const inner = el.firstElementChild;

    const FOLLOW_WITHIN_PX = 60;
    const JUMP_BEYOND_PX = 200;
    const fromBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight;

    const onScroll = () => {
      const distance = fromBottom();
      stickRef.current = distance < FOLLOW_WITHIN_PX;
      setShowJump(distance > JUMP_BEYOND_PX);
    };

    const ro = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    });

    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    if (inner) ro.observe(inner);
    onScroll();

    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    if (messages.length === 0) {
      stickRef.current = true;
      setShowJump(false);
    }
  }, [messages.length]);

  const historyShown = !loadingSession || messages.length > 0;
  useLayoutEffect(() => {
    if (!historyShown) return;
    const el = messagesRef.current;
    if (!el) return;
    stickRef.current = true;
    setShowJump(false);
    el.scrollTop = el.scrollHeight;
  }, [historyShown, sessionId]);

  return {
    messagesRef,
    scrollToBottom,
    loadOlderKeepingScroll,
    showJump,
    historyShown,
  };
}
