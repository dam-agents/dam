import { StopFilledAlt } from "@carbon/icons-react";
import type { SpendAmount, TurnSummary } from "api-server-api";
import {
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { Message, ToolChip } from "../../../types.js";
import { partKey } from "../../a2ui/lib/collect-blocks.js";
import { withoutAgentMarkup } from "../../acp/agent-markup.js";
import { describeSendError } from "../../acp/errors.js";
import { hasAgentContent } from "../../acp/session-projection.js";
import { useIsFanOutChip } from "../../invocations/components/delegation-owners.js";
import { TurnTelemetry } from "../../telemetry/components/turn-telemetry.js";
import { activityItems } from "../lib/activity-groups.js";
import { agentChangeOf } from "../lib/agent-change.js";
import { modelDisplayName } from "../lib/model-name.js";
import { repliesOnlyWithError } from "../lib/replies-only-with-error.js";
import type { MessageTime } from "../lib/thread-items.js";
import { ActivityGroup } from "./activity-group.js";
import { AgentChangeCards } from "./agent-change-card.js";
import { ChatMessagePart } from "./chat-message-part.js";
import {
  AgentSpeaker,
  type SpeakerAgent,
  SpeakerRow,
} from "./chat-message-speaker.js";
import { PermissionStatusLine } from "./permission-prompt.js";
import { ProviderFailureCard } from "./provider-failure-card.js";
import { QuietNotice } from "./quiet-notice.js";
import { SendErrorCard } from "./send-error-card.js";
import { type OnRetry, UndeliveredNotice } from "./undelivered-notice.js";
import { WorkingDots } from "./working-dots.js";

type LoadOlderOutcome = "paged" | "reloaded" | "noop";

type Props = BaseProps & MessageTime;

interface BaseProps {
  message: Message;
  avatarAgent?: SpeakerAgent;
  onAgentClick?: () => void;
  userLabel?: string;
  footer?: ReactNode;
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
  turn?: TurnSummary;
  turnSpend?: readonly SpendAmount[] | undefined;
  agentId?: string;
  sessionId?: string;
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
  onAgentClick,
  userLabel,
  footer,
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
  turn,
  turnSpend,
  agentId,
  sessionId,
}: Props) {
  const isFanOut = useIsFanOutChip();
  const changeCards = useContext(AgentChangeCards);
  const standalone = useCallback(
    (chip: ToolChip) =>
      isFanOut(chip) || (changeCards && agentChangeOf(chip) !== null),
    [isFanOut, changeCards],
  );
  const items = useMemo(
    () =>
      message.role === "assistant"
        ? activityItems(withoutAgentMarkup(message.parts), standalone)
        : activityItems(message.parts, () => true),
    [message.role, message.parts, standalone],
  );
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
  const providerFailure =
    error !== undefined &&
    describeSendError(error.message).kind === "provider-unavailable";
  const errorOnly =
    providerFailure &&
    isAssistant &&
    repliesOnlyWithError(message, error.message);
  const interrupted =
    error !== undefined &&
    isAssistant &&
    hasAgentContent(message) &&
    !errorOnly;
  if (isAssistant && streaming && queued && parts.length === 0) return null;
  const working = isAssistant && streaming && !queued && !hasPendingPermission;
  const speaker = isAssistant ? (
    <AgentSpeaker agent={avatarAgent} />
  ) : (
    userLabel !== undefined && (
      <span className="text-2xs font-medium text-muted-foreground">
        {userLabel}
      </span>
    )
  );

  const messageBlock = (
    <div
      data-testid="chat-message"
      data-role={role}
      className={cn(
        "group/message relative flex flex-col gap-1",
        ((isLast && streaming) || arriving) && "anim-in",
        isAssistant ? "items-start" : "items-end",
      )}
    >
      {speaker && !continued && (
        <SpeakerRow agentName={avatarAgent?.name} onAgentClick={onAgentClick}>
          {speaker}
        </SpeakerRow>
      )}
      {(!error || (parts.length > 0 && !errorOnly) || undelivered) && (
        <div
          className={cn(
            isAssistant
              ? "flex flex-col gap-4 w-full max-w-full"
              : "flex flex-col gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-foreground",
            !isAssistant && (undelivered ? "border-danger" : "border-border"),
          )}
        >
          {items.map((item, i) =>
            item.kind === "group" ? (
              <ActivityGroup
                key={item.index}
                chips={item.chips}
                streaming={streaming}
              />
            ) : (
              <ChatMessagePart
                key={item.index}
                part={item.part}
                partKey={partKey(message.id, item.index)}
                role={role}
                streaming={streaming}
                isLast={i === items.length - 1}
                interactive={isAssistant && isLast && !readOnly && !streaming}
                onFileClick={readOnly ? undefined : onFileClick}
              />
            ),
          )}
          {isAssistant && isLast && !readOnly && <PermissionStatusLine />}
          {isAssistant && stopped && !streaming && (
            <p
              data-testid="reply-stopped-marker"
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <StopFilledAlt size={12} className="shrink-0" />
              Stopped
            </p>
          )}
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
          {undelivered && !providerFailure && (
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
      {error &&
        isAssistant &&
        (providerFailure && (isLast || !interrupted) ? (
          <ProviderFailureCard
            message={message}
            agentId={agentId}
            sessionId={sessionId}
            interrupted={interrupted}
            onRetry={interrupted ? undefined : onRetry}
            className={cn(interrupted && "mt-2")}
          />
        ) : (
          <SendErrorCard
            rawError={error.message}
            interrupted={interrupted}
            quiet={!isLast}
          />
        ))}
      {turn && agentId !== undefined && sessionId !== undefined && (
        <TurnTelemetry
          agentId={agentId}
          sessionId={sessionId}
          turn={turn}
          spend={turnSpend}
          className="self-stretch"
        />
      )}
      {(timeLabel !== undefined || footer) && (
        <div
          className={cn(
            "flex items-center gap-1 transition-opacity md:absolute md:top-full md:z-10 md:pt-0.5 md:opacity-0 md:group-hover/message:opacity-100 md:group-focus-within/message:opacity-100",
            isAssistant ? "md:left-0" : "md:right-0",
            !footer && "max-md:hidden",
          )}
        >
          {timeLabel !== undefined && (
            <Tooltip side="bottom" content={timeTitle}>
              <span
                data-testid="message-time"
                className="px-1 text-2xs text-muted-foreground cursor-default max-md:hidden"
              >
                {timeLabel}
              </span>
            </Tooltip>
          )}
          {footer}
        </div>
      )}
    </div>
  );
  if (!(undelivered && providerFailure)) return messageBlock;
  return (
    <>
      {messageBlock}
      <div
        data-testid="provider-failure-reply"
        className="flex flex-col items-start gap-1"
      >
        <SpeakerRow agentName={avatarAgent?.name} onAgentClick={onAgentClick}>
          <AgentSpeaker agent={avatarAgent} />
        </SpeakerRow>
        <ProviderFailureCard
          message={message}
          agentId={agentId}
          sessionId={sessionId}
          interrupted={false}
          onRetry={onRetry}
          onDelete={onDelete}
        />
      </div>
    </>
  );
});
