import { useCallback } from "react";

import { useStore } from "../../../store.js";
import type { Message, VerdictPart } from "../../../types.js";
import { useHasPendingPermission } from "../hooks/use-pending-permissions.js";
import { ChatInput, type ChatInputProps } from "./chat-input.js";
import {
  PermissionPrompt,
  type PermissionVerdict,
} from "./permission-prompt.js";

function ownsToolCall(m: Message, toolCallId: string): boolean {
  return m.parts.some((p) => p.kind === "tool" && p.toolCallId === toolCallId);
}

/** The slot below the thread: the blocking permission prompt while a
 *  tool-call approval is pending, the chat input otherwise. Resolved verdicts
 *  are appended to the transcript as message parts. */
export function ChatInputArea(props: ChatInputProps) {
  const hasPending = useHasPendingPermission();
  const setMessages = useStore((s) => s.setMessages);

  // Anchor the verdict on the assistant message owning the approved tool
  // call, so it stays in place as the response continues streaming below it.
  // Falls back to the last assistant message when no tool part matches (the
  // harness may request permission before emitting the tool-call update).
  const appendVerdict = useCallback(
    (verdict: PermissionVerdict, toolCallId: string) => {
      setMessages((prev) => {
        let anchor = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          const m = prev[i];
          if (m.role !== "assistant" || m.notice) continue;
          if (anchor === -1) anchor = i;
          if (ownsToolCall(m, toolCallId)) {
            anchor = i;
            break;
          }
        }
        if (anchor === -1) return prev;
        const part: VerdictPart = { kind: "verdict", ...verdict };
        return prev.map((m, j) =>
          j === anchor ? { ...m, parts: [...m.parts, part] } : m,
        );
      });
    },
    [setMessages],
  );

  if (hasPending) return <PermissionPrompt onResolved={appendVerdict} />;
  return <ChatInput {...props} />;
}
