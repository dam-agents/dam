import { useCallback } from "react";

import { useStore } from "../../../store.js";
import type { VerdictPart } from "../../../types.js";
import { ChatInput, type ChatInputProps } from "./chat-input.js";
import {
  PermissionPrompt,
  type PermissionVerdict,
} from "./permission-prompt.js";

/** The slot below the thread: the blocking permission prompt while a
 *  tool-call approval is pending, the chat input otherwise. Resolved verdicts
 *  are appended to the transcript as message parts. */
export function ChatInputArea(props: ChatInputProps) {
  const hasPending = useStore((s) =>
    s.sessionId
      ? s.pendingPermissions.some((p) => p.sessionId === s.sessionId)
      : false,
  );
  const setMessages = useStore((s) => s.setMessages);

  // Anchor the verdict on the assistant message it interrupted, so it stays
  // in place as the response continues streaming below it.
  const appendVerdict = useCallback(
    (verdict: PermissionVerdict) => {
      setMessages((prev) => {
        for (let i = prev.length - 1; i >= 0; i--) {
          const m = prev[i];
          if (m.role !== "assistant" || m.notice) continue;
          const part: VerdictPart = { kind: "verdict", ...verdict };
          return prev.map((x, j) =>
            j === i ? { ...x, parts: [...x.parts, part] } : x,
          );
        }
        return prev;
      });
    },
    [setMessages],
  );

  if (hasPending) return <PermissionPrompt onResolved={appendVerdict} />;
  return <ChatInput {...props} />;
}
