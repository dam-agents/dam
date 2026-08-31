import { useCallback, useRef, useState } from "react";

import type { ScheduleDraft } from "../../sandboxes/hooks/use-setup-form.js";
import type { ScheduleFormValues } from "../forms/schedule-form-schema.js";
import {
  formatScheduleSummary,
  parseNaturalSchedule,
} from "../lib/parse-natural-schedule.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  preview?: ScheduleFormValues;
}

const GREETING =
  'Describe your schedule in plain language. For example:\n"Every weekday at 9am, run a code review"';

let msgId = 0;
function nextId(): string {
  return `msg-${++msgId}`;
}

function assistantMsg(text: string, preview?: ScheduleFormValues): ChatMessage {
  return { id: nextId(), role: "assistant", text, preview };
}

function userMsg(text: string): ChatMessage {
  return { id: nextId(), role: "user", text };
}

export function useScheduleChat(
  initialDraft: ScheduleDraft | null,
  onConfirm: (values: ScheduleFormValues) => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const msgs: ChatMessage[] = [assistantMsg(GREETING)];
    if (initialDraft) {
      msgs.push(
        assistantMsg(
          `You already have a schedule configured: ${formatScheduleSummary(initialDraft)}. You can describe a new one to replace it.`,
        ),
      );
    }
    return msgs;
  });
  const [pendingValues, setPendingValues] = useState<ScheduleFormValues | null>(
    null,
  );
  const failCount = useRef(0);

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const newMsgs: ChatMessage[] = [userMsg(trimmed)];
    const result = parseNaturalSchedule(trimmed);

    if (result.missing.includes("timing")) {
      failCount.current += 1;
      if (failCount.current >= 3) {
        newMsgs.push(
          assistantMsg(
            'I\'m having trouble understanding the schedule. Try the Form tab for precise control, or try something like "every weekday at 9am".',
          ),
        );
      } else {
        newMsgs.push(
          assistantMsg(
            'I couldn\'t figure out the timing. Could you try something like "every weekday at 9am" or "every 30 minutes"?',
          ),
        );
      }
      setMessages((prev) => [...prev, ...newMsgs]);
      return;
    }

    failCount.current = 0;

    if (result.missing.includes("task")) {
      setPendingValues(result.values);
      newMsgs.push(
        assistantMsg(
          `Got it — ${formatScheduleSummary(result.values)}. What task should the agent run on this schedule?`,
        ),
      );
      setMessages((prev) => [...prev, ...newMsgs]);
      return;
    }

    const values = result.values;
    setPendingValues(values);
    newMsgs.push(
      assistantMsg(
        `Here's what I understood:\n\n**${formatScheduleSummary(values)}**\nTask: ${values.task}\nTimezone: ${values.timezone}\nSession: ${values.sessionMode}`,
        values,
      ),
    );
    setMessages((prev) => [...prev, ...newMsgs]);
  }, []);

  const handleTaskReply = useCallback(
    (text: string) => {
      if (!pendingValues) {
        sendMessage(text);
        return;
      }
      const trimmed = text.trim();
      if (!trimmed) return;

      const values: ScheduleFormValues = {
        ...pendingValues,
        task: trimmed,
        name: trimmed.length < 40 ? trimmed : pendingValues.name,
      };
      setPendingValues(values);
      const newMsgs: ChatMessage[] = [
        userMsg(trimmed),
        assistantMsg(
          `Here's your schedule:\n\n**${formatScheduleSummary(values)}**\nTask: ${values.task}\nTimezone: ${values.timezone}\nSession: ${values.sessionMode}`,
          values,
        ),
      ];
      setMessages((prev) => [...prev, ...newMsgs]);
    },
    [pendingValues, sendMessage],
  );

  const confirm = useCallback(() => {
    if (!pendingValues) return;
    onConfirm(pendingValues);
    setMessages((prev) => [
      ...prev,
      assistantMsg("Schedule confirmed. It will be created with your agent."),
    ]);
    setPendingValues(null);
  }, [pendingValues, onConfirm]);

  const needsTask = pendingValues !== null && !pendingValues.task;

  const send = useCallback(
    (text: string) => {
      if (needsTask) {
        handleTaskReply(text);
      } else {
        sendMessage(text);
      }
    },
    [needsTask, handleTaskReply, sendMessage],
  );

  return {
    messages,
    send,
    confirm,
    pendingValues,
  };
}
