import { StopFilledAlt } from "@carbon/icons-react";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { Message } from "../../../types.js";
import { hasAgentContent } from "../../acp/session-projection.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { modelDisplayName } from "../lib/model-name.js";
import type { MessageTime } from "../lib/thread-items.js";
import { ChatMessagePart } from "./chat-message-part.js";
import { PermissionStatusLine } from "./permission-prompt.js";
import { QuietNotice } from "./quiet-notice.js";
import { SendErrorCard } from "./send-error-card.js";
import { type OnRetry, UndeliveredNotice } from "./undelivered-notice.js";
import { WorkingDots } from "./working-dots.js";

type LoadOlderOutcome = "paged" | "reloaded" | "noop";

type Props = BaseProps & MessageTime;

interface BaseProps {
  message: Message;
  avatarAgent?: { name: string; avatar: string | null };
  userLabel?: string;
  readOnly?: boolean;
  showModel?: boolean;
  continued?: boolean;
  arriving?: boolean;
  isLast: boolean;
  hasPendingPermission: boolean;
  pendingNotice?: ReactNode;
  onRetry: OnRetry;
  onFileClick: (path: string) => void;
  onDelete: (id: string) => void;
  onLoadOlder?: (before: string) => Promise<LoadOlderOutcome>;
}

function LoadOlderMarker({
  before,
  onLoadOlder,
}: {
  before: string;
  onLoadOlder: (before: string) => Promise<LoadOlderOutcome>;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  const fire = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setFailed(false);
    void onLoadOlder(before).then((outcome) => {
      if (outcome !== "noop") return;
      startedRef.current = false;
      setFailed(true);
    });
  }, [before, onLoadOlder]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      fire();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fire]);

  return (
    <div ref={sentinelRef} className="flex justify-center anim-in">
      {failed ? (
        <button
          type="button"
          onClick={fire}
          className="text-2xs italic text-muted-foreground px-3 py-1 border-t border-b border-border/60 hover:text-foreground"
        >
          Couldn&apos;t load earlier messages — tap to retry
        </button>
      ) : (
        <span className="text-2xs italic text-muted-foreground px-3 py-1 border-t border-b border-border/60">
          Loading earlier messages…
        </span>
      )}
    </div>
  );
}

export const ChatMessage = memo(function ChatMessage({
  message,
  avatarAgent,
  userLabel = "You",
  readOnly = false,
  showModel = false,
  continued = false,
  arriving = false,
  isLast,
  timeLabel,
  timeTitle,
  hasPendingPermission,
  pendingNotice,
  onRetry,
  onFileClick,
  onDelete,
  onLoadOlder,
}: Props) {
  if (message.notice) {
    if (message.loadOlderBefore !== undefined && onLoadOlder) {
      return (
        <LoadOlderMarker
          before={message.loadOlderBefore}
          onLoadOlder={onLoadOlder}
        />
      );
    }
    return (
      <div className="flex justify-center anim-in">
        <span className="text-2xs italic text-muted-foreground px-3 py-1 border-t border-b border-border/60">
          {message.parts.find((p) => p.kind === "text")?.text ?? "…"}
        </span>
      </div>
    );
  }

  const { role, parts, streaming, queued, error, stopped } = message;
  const isAssistant = role === "assistant";
  const undelivered = !isAssistant && error !== undefined;
  if (isAssistant && streaming && queued && parts.length === 0) return null;
  const working = isAssistant && streaming && !queued && !hasPendingPermission;

  return (
    <div
      data-testid="chat-message"
      data-role={role}
      className={cn(
        "flex flex-col gap-1",
        ((isLast && streaming) || arriving) && "anim-in",
        isAssistant ? "items-start" : "items-end",
      )}
    >
      <div
        className={cn(
          "flex gap-1.5 mb-0.5",
          avatarAgent === undefined ? "items-baseline" : "items-center",
          continued && "hidden",
        )}
      >
        {isAssistant && avatarAgent !== undefined && (
          <AgentAvatar
            name={avatarAgent.name}
            avatar={avatarAgent.avatar}
            size={24}
          />
        )}
        <span className="text-2xs font-medium text-muted-foreground">
          {isAssistant ? (avatarAgent?.name ?? "Agent") : userLabel}
        </span>
        {timeLabel !== undefined && (
          <Tooltip side="top" content={timeTitle}>
            <span className="text-2xs text-muted-foreground cursor-default">
              {timeLabel}
            </span>
          </Tooltip>
        )}
      </div>
      {(!error || parts.length > 0 || undelivered) && (
        <div
          className={cn(
            isAssistant
              ? "flex flex-col gap-4 w-full max-w-full"
              : "flex flex-col gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-foreground",
            !isAssistant && (undelivered ? "border-danger" : "border-border"),
          )}
        >
          {parts.map((p, i) => (
            <ChatMessagePart
              key={i}
              part={p}
              role={role}
              streaming={streaming}
              isLast={i === parts.length - 1}
              onFileClick={readOnly ? undefined : onFileClick}
            />
          ))}
          {isAssistant && isLast && !readOnly && <PermissionStatusLine />}
          {isAssistant && (streaming || isLast) && (
            <span
              role={working ? "status" : undefined}
              aria-hidden={!working}
              className={cn(
                "inline-flex items-center py-1",
                !working && "invisible",
              )}
            >
              <WorkingDots size="md" className="text-accent" />
              {working && <span className="sr-only">Working</span>}
            </span>
          )}
          {isAssistant && streaming && parts.length === 0 && pendingNotice}
          {isAssistant && stopped && !streaming && (
            <p
              data-testid="reply-stopped-marker"
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <StopFilledAlt size={12} className="shrink-0" />
              Stopped
            </p>
          )}
          {undelivered && (
            <UndeliveredNotice
              message={message}
              onRetry={onRetry}
              onDelete={onDelete}
            />
          )}
        </div>
      )}
      {isAssistant && showModel && !streaming && message.model && (
        <Tooltip side="top" content={message.model}>
          <span
            data-testid="reply-model"
            className="text-2xs text-muted-foreground cursor-default"
          >
            {modelDisplayName(message.model)}
          </span>
        </Tooltip>
      )}
      {isAssistant && !streaming && message.stoppedAtOutputLimit && (
        <QuietNotice testId="reply-output-limit-notice">
          Reply stopped at the output limit.
        </QuietNotice>
      )}
      {error && isAssistant && (
        <SendErrorCard
          rawError={error.message}
          interrupted={hasAgentContent(message)}
          quiet={!isLast}
        />
      )}
    </div>
  );
});
