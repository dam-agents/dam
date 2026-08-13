import { cn } from "@/lib/utils";

import type { Attachment, Message } from "../../../types.js";
import { hasAgentContent } from "../../acp/session-projection.js";
import { BusyIndicator } from "./busy-indicator.js";
import { ChatMessagePart } from "./chat-message-part.js";
import { PermissionStatusLine } from "./permission-prompt.js";
import { SendErrorCard } from "./send-error-card.js";

interface Props {
  message: Message;
  isLast: boolean;
  hasPendingPermission: boolean;
  onRetry: (text: string, attachments?: Attachment[]) => void;
  onFileClick: (path: string) => void;
}

export function ChatMessage({
  message,
  isLast,
  hasPendingPermission,
  onRetry,
  onFileClick,
}: Props) {
  if (message.notice) {
    return (
      <div className="flex justify-center anim-in">
        <span className="text-[11px] italic text-muted-foreground px-3 py-1 border-t border-b border-border/60">
          {message.parts.find((p) => p.kind === "text")?.text ?? "…"}
        </span>
      </div>
    );
  }

  const { role, parts, streaming, queued, error } = message;
  const isAssistant = role === "assistant";
  const retryWith = error?.retryWith;

  return (
    <div
      data-testid="chat-message"
      data-role={role}
      className={cn(
        "flex flex-col gap-1 anim-in",
        isAssistant ? "items-start" : "items-end",
      )}
    >
      <span className="text-[11px] font-medium text-muted-foreground mb-0.5">
        {isAssistant ? "Agent" : "You"}
      </span>
      {(!error || parts.length > 0) && (
        <div
          className={
            isAssistant
              ? "flex flex-col gap-4 w-full max-w-full"
              : "flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground"
          }
        >
          {parts.map((p, i) => (
            <ChatMessagePart
              key={i}
              part={p}
              role={role}
              streaming={streaming}
              isLast={i === parts.length - 1}
              onFileClick={onFileClick}
            />
          ))}
          {streaming && queued && parts.length === 0 && (
            <span
              data-testid="prompt-queued-indicator"
              className="text-xs text-muted-foreground italic"
            >
              Waiting for previous prompt…
            </span>
          )}
          {isAssistant && isLast && <PermissionStatusLine />}
          {isAssistant && streaming && !queued && !hasPendingPermission && (
            <BusyIndicator className="py-1" />
          )}
        </div>
      )}
      {error && (
        <SendErrorCard
          rawError={error.message}
          interrupted={hasAgentContent(message)}
          onRetry={
            retryWith
              ? () => onRetry(retryWith.text, retryWith.attachments)
              : undefined
          }
        />
      )}
    </div>
  );
}
