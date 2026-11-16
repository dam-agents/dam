import { useCallback } from "react";

import { useStore } from "../../../store.js";
import type { Message, VerdictPart } from "../../../types.js";
import { useFeatures } from "../../features/api/queries.js";
import {
  OwnerQuestionPrompt,
  PostponedQuestionsLine,
} from "../../invocations/components/owner-question-prompt.js";
import {
  questionKey,
  useOwnerQuestionQueue,
} from "../../invocations/hooks/use-owner-question-queue.js";
import { useHasPendingPermission } from "../hooks/use-pending-permissions.js";
import { ChatInput, type ChatInputProps } from "./chat-input.js";
import { EgressApprovalPrompt } from "./egress-approval-prompt.js";
import {
  PermissionPrompt,
  type PermissionVerdict,
} from "./permission-prompt.js";

function ownsToolCall(m: Message, toolCallId: string): boolean {
  return m.parts.some((p) => p.kind === "tool" && p.toolCallId === toolCallId);
}

export function ChatInputArea(
  props: ChatInputProps & { channelLive: boolean },
) {
  const hasPending = useHasPendingPermission();
  const setMessages = useStore((s) => s.setMessages);
  const agentId = useStore((s) => s.selectedAgent);
  const sessionId = useStore((s) => s.sessionId);
  const questions = useOwnerQuestionQueue(agentId, sessionId);
  /* UNIT_BOUNDARY_DESCRIPTION: a waiting network approval shows above the message box only with the chat-network-approvals feature on; without it, it waits in the approvals list and the notifications alone, as before the feature. */
  const chatApprovals = useFeatures().data?.["chat-network-approvals"] ?? false;

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

  if (hasPending)
    return (
      <PermissionPrompt
        channelLive={props.channelLive}
        onResolved={appendVerdict}
      />
    );
  if (agentId && questions.current)
    return (
      <OwnerQuestionPrompt
        key={questionKey(questions.current)}
        driverAgentId={agentId}
        question={questions.current}
        more={questions.more}
        onLater={questions.later}
        onAnswered={questions.answered}
      />
    );
  return (
    <>
      {chatApprovals && <EgressApprovalPrompt />}
      <PostponedQuestionsLine
        questions={questions.postponed}
        onAnswer={questions.resume}
      />
      <ChatInput {...props} />
    </>
  );
}
