import {
  EdgeDevice,
  OverflowMenuVertical,
  Time,
  TrashCan,
  Warning,
} from "@carbon/icons-react";
import {
  type BackgroundWorkItemView,
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
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { clickableProps } from "@/lib/clickable";
import { formatTimestamp } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { formatTokens, formatUsdCell } from "../../metrics/lib/format.js";
import { slackSessionKind } from "../lib/session-category.js";
import { backgroundWorkLabel } from "./background-work-indicator.js";
import { WorkingDots } from "./working-dots.js";

const LONG_PRESS_MS = 400;

const NO_WORK: readonly BackgroundWorkItemView[] = Object.freeze([]);

type ChannelKind = "agent" | "slack" | "schedule" | "approval";

const iconBg: Record<ChannelKind, string> = {
  agent: "bg-[#f2f4f8] text-foreground dark:bg-white/10",
  slack:
    "bg-white border border-[#dde1e6] dark:bg-white/5 dark:border-white/10",
  schedule:
    "bg-[#edf5ff] text-[#0f62fe] dark:bg-[#0f62fe]/15 dark:text-[#78a9ff]",
  approval: "bg-warning/10 text-warning",
};

function channelKindFor(s: SessionView, needsApproval: boolean): ChannelKind {
  if (needsApproval) return "approval";
  if (s.type === SessionType.ScheduleCron || s.scheduleId) return "schedule";
  if (
    s.type === SessionType.ChannelSlack ||
    s.type === SessionType.ChannelTelegram ||
    s.threadTs
  )
    return "slack";
  return "agent";
}

function channelIcon(kind: ChannelKind) {
  switch (kind) {
    case "schedule":
      return <Time size={16} />;
    case "slack":
      return <img src="/icons/slack.svg" alt="Slack" className="size-4" />;
    case "approval":
      return <Warning size={16} />;
    case "agent":
      return <EdgeDevice size={16} />;
  }
}

interface Props {
  session: SessionView;
  active: boolean;
  working: boolean;
  needsApproval: boolean;
  unread?: boolean;
  draft?: boolean;
  backgroundWork?: readonly BackgroundWorkItemView[];
  cost?: SessionRuntime;
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
    : unread || working
      ? "font-semibold text-foreground"
      : "font-normal text-foreground";

  const kind = channelKindFor(s, needsApproval);
  const slackKind = slackSessionKind(s);
  const hasBackgroundWork = backgroundWork.length > 0;

  return (
    <div
      data-testid="session-row"
      data-session-id={s.sessionId}
      data-active={active ? "true" : "false"}
      className={cn(
        "group relative flex gap-3 rounded-xl px-4 py-3 cursor-pointer transition-colors",
        active
          ? "bg-muted"
          : (unread || working) && !active
            ? "bg-[#f4f4f4]/50 dark:bg-white/[0.03] hover:bg-muted/60"
            : "hover:bg-muted/60",
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
      <div className="relative shrink-0 pt-0.5">
        <div
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            iconBg[kind],
          )}
        >
          {channelIcon(kind)}
        </div>
        {working && (
          <span className="working-dots absolute -left-[6px] top-0 flex items-center -space-x-[1px]">
            <span className="size-1.5 rounded-full border border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-1.5 rounded-full border border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-1.5 rounded-full border border-background bg-[#a2a9b0] dark:bg-white/40" />
          </span>
        )}
        {!working && (unread || needsApproval) && (
          <span className="absolute -left-0.5 top-0 size-2 rounded-full border-[1.5px] border-background bg-accent" />
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className={`text-sm min-w-0 truncate ${titleClass}`}>
            {titleLabel}
          </span>
          {slackKind && (
            <span className="shrink-0 text-xs text-muted-foreground/60">
              {slackKind === "ambient" ? "Ambient" : "Thread"}
            </span>
          )}
          {draft && !working && !needsApproval && !unread && (
            <span className="shrink-0 text-xs text-muted-foreground/60">
              Draft
            </span>
          )}
          {hasBackgroundWork && !working && (
            <WorkingDots
              className="working-dots-slow text-success shrink-0"
              title={backgroundWorkLabel(backgroundWork)}
            />
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {formatTimestamp(s.updatedAt ?? s.createdAt)}
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            data-testid="session-menu-button"
            variant="ghost"
            size="icon-xs"
            className={cn("shrink-0", HOVER_ACTION)}
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
