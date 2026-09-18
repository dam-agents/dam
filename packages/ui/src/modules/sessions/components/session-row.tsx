import {
  Code,
  Edit,
  OverflowMenuVertical,
  Time,
  TrashCan,
} from "@carbon/icons-react";
import {
  type BackgroundWorkItemView,
  ChannelType,
  SessionMode,
  type SessionRuntime,
  SessionType,
  type SessionView,
} from "api-server-api";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HOVER_ACTION, HOVER_YIELD } from "@/components/ui/hover-action";
import { clickableProps } from "@/lib/clickable";
import { formatTimestamp, timeAgo } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { formatTokens, formatUsdCell } from "../../metrics/lib/format.js";
import { runTimeLabel } from "../lib/run-time.js";
import { backgroundWorkLabel } from "./background-work-indicator.js";
import { WorkingDots } from "./working-dots.js";

const LONG_PRESS_MS = 400;

const NO_WORK: readonly BackgroundWorkItemView[] = Object.freeze([]);

interface Props {
  session: SessionView;
  active: boolean;
  working: boolean;
  needsApproval: boolean;
  unread?: boolean;
  draft?: boolean;
  backgroundWork?: readonly BackgroundWorkItemView[];
  cost?: SessionRuntime;
  conversation?: string;
  onResume: () => void;
  onDelete: () => void;
}

export function SessionRow({
  session: s,
  active,
  working,
  needsApproval,
  unread = false,
  draft = false,
  backgroundWork = NO_WORK,
  cost,
  conversation,
  onResume,
  onDelete,
}: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const startPress = useCallback(() => {
    didLongPress.current = false;
    timerRef.current = setTimeout(() => {
      didLongPress.current = true;
      setMenuOpen(true);
    }, LONG_PRESS_MS);
  }, []);

  const endPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleClick = useCallback(() => {
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    onResume();
  }, [onResume, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const titleLabel = s.title || `(no title · ${s.sessionId.slice(0, 8)})`;
  const titleClass = !s.title
    ? "text-muted-foreground italic"
    : unread
      ? "font-semibold text-foreground"
      : "font-normal text-foreground";

  const scheduled = s.type === SessionType.ScheduleCron || !!s.scheduleId;
  const runTime = scheduled ? runTimeLabel(s) : null;
  const terminal = s.mode === SessionMode.Terminal;
  const messenger =
    s.type === SessionType.ChannelSlack
      ? ChannelType.Slack
      : s.type === SessionType.ChannelTelegram
        ? ChannelType.Telegram
        : null;

  return (
    <div
      data-testid="session-row"
      data-session-id={s.sessionId}
      data-active={active ? "true" : "false"}
      className={cn(
        "group relative flex items-center gap-1 px-4 py-3 cursor-pointer border-b border-border transition-colors select-none",
        active ? "bg-muted" : "hover:bg-muted/60",
      )}
      {...clickableProps(handleClick)}
      onTouchStart={startPress}
      onTouchEnd={endPress}
      onTouchCancel={endPress}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="relative flex items-center gap-1.5">
          {}
          <span className={`text-[13px] min-w-0 truncate ${titleClass}`}>
            {titleLabel}
          </span>
          <SessionIndicators
            scheduled={scheduled}
            terminal={terminal}
            messenger={messenger}
            needsApproval={needsApproval}
            working={working}
            draft={draft}
            backgroundWork={backgroundWork}
          />
          {}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-testid="session-menu-button"
                variant="ghost"
                size="icon-xs"
                className={cn(
                  "absolute top-1/2 -right-1 -translate-y-1/2",
                  HOVER_ACTION,
                )}
                onClick={(e) => e.stopPropagation()}
                aria-label="More actions"
              >
                <OverflowMenuVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                data-testid="session-delete-button"
                tone="danger"
                onSelect={onDelete}
              >
                <TrashCan size={13} /> Delete session
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <span className="text-[11px] text-muted-foreground truncate">
          {conversation ? `${conversation} · ` : ""}
          <span title={formatTimestamp(s.updatedAt ?? s.createdAt)}>
            {timeAgo(s.updatedAt ?? s.createdAt)}
          </span>
          {runTime && (
            <span data-testid="session-run-time">
              {" · "}
              {runTime}
            </span>
          )}
          {cost && (
            <span
              className="tabular-nums"
              title={`${cost.calls} API calls · ${formatTokens(cost.inputTokens + cost.cacheReadTokens + cost.cacheCreationTokens)} in / ${formatTokens(cost.outputTokens)} out · $${cost.costUsd.toFixed(4)}`}
            >
              {" · "}
              {formatUsdCell(cost.costUsd)}
            </span>
          )}
        </span>
      </div>
      {}
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-3 top-2 z-popover rounded-lg border border-border bg-popover py-1 anim-scale-in shadow-md"
        >
          <Button
            variant="ghost"
            tone="danger"
            size="sm"
            className="w-full justify-start"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              onDelete();
            }}
          >
            <TrashCan size={13} /> Delete session
          </Button>
        </div>
      )}
    </div>
  );
}

function SessionIndicators({
  scheduled,
  terminal,
  messenger,
  needsApproval,
  working,
  draft,
  backgroundWork,
}: {
  scheduled: boolean;
  terminal: boolean;
  messenger: ChannelType | null;
  needsApproval: boolean;
  working: boolean;
  draft: boolean;
  backgroundWork: readonly BackgroundWorkItemView[];
}) {
  const hasBackgroundWork = backgroundWork.length > 0;
  if (
    !scheduled &&
    !terminal &&
    !messenger &&
    !needsApproval &&
    !working &&
    !hasBackgroundWork &&
    !draft
  )
    return null;
  return (
    <span
      className={cn(
        "ml-auto flex shrink-0 items-center gap-2 pl-2 pr-6 hover-capable:pr-0",
        HOVER_YIELD,
      )}
    >
      {terminal && (
        <Code size={16} className="text-foreground" aria-label="Terminal" />
      )}
      {scheduled && (
        <Time size={16} className="text-foreground" aria-label="Scheduled" />
      )}
      {needsApproval ? (
        <IndicatorBox>
          <span
            data-testid="session-approval-dot"
            role="img"
            aria-label="Needs your approval"
            className="w-2 h-2 rounded-full bg-accent"
          />
        </IndicatorBox>
      ) : working ? (
        <IndicatorBox>
          <WorkingDots className="text-accent" title="Working" />
        </IndicatorBox>
      ) : hasBackgroundWork ? (
        <IndicatorBox>
          <WorkingDots
            className="working-dots-slow text-success"
            title={backgroundWorkLabel(backgroundWork)}
          />
        </IndicatorBox>
      ) : draft ? (
        <span
          data-testid="session-draft-marker"
          role="img"
          aria-label="Has a draft"
          title="Has a draft"
          className="inline-flex text-muted-foreground shrink-0"
        >
          <Edit size={16} />
        </span>
      ) : null}
      {messenger && !working && (
        <ConnectionIcon
          iconSlug={messenger}
          alt={messenger === ChannelType.Slack ? "Slack" : "Telegram"}
          size={16}
          className="shrink-0"
        />
      )}
    </span>
  );
}

function IndicatorBox({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      {children}
    </span>
  );
}
