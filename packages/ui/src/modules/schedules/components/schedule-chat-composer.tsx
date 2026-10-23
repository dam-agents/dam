import { Send } from "@carbon/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { ScheduleDraft } from "../../sandboxes/hooks/use-setup-form.js";
import type { ScheduleFormValues } from "../forms/schedule-form-schema.js";
import {
  type ChatMessage,
  useScheduleChat,
} from "../hooks/use-schedule-chat.js";

interface Props {
  draft: ScheduleDraft | null;
  onConfirm: (values: ScheduleFormValues) => void;
  onSwitchToForm: (values: ScheduleFormValues) => void;
}

export function ScheduleChatComposer({
  draft,
  onConfirm,
  onSwitchToForm,
}: Props) {
  const { messages, send, confirm, pendingValues } = useScheduleChat(
    draft,
    onConfirm,
  );
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    send(trimmed);
    setInput("");
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border">
      <div
        ref={scrollRef}
        className="flex max-h-[400px] min-h-[200px] flex-col gap-3 overflow-y-auto p-4"
      >
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onConfirm={confirm}
            onEditInForm={
              msg.preview ? () => onSwitchToForm(msg.preview!) : undefined
            }
          />
        ))}
      </div>

      <div className="flex items-end gap-2 border-t border-border p-3">
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            pendingValues && !pendingValues.task
              ? "Describe the task..."
              : "Describe your schedule..."
          }
          rows={1}
          className="min-h-[40px] resize-none"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={handleSend}
          disabled={!input.trim()}
        >
          <Send size={16} />
        </Button>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onConfirm,
  onEditInForm,
}: {
  message: ChatMessage;
  onConfirm?: () => void;
  onEditInForm?: () => void;
}) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-4 py-2.5 text-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        <p className="whitespace-pre-wrap">{message.text}</p>
        {message.preview && (
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="default"
              className="h-8 text-sm"
              onClick={onConfirm}
            >
              Confirm
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-sm"
              onClick={onEditInForm}
            >
              Edit in form
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
