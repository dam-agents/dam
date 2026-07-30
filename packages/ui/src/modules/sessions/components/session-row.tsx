import {
  Code,
  Hashtag,
  OverflowMenuVertical,
  Time,
  TrashCan,
} from "@carbon/icons-react";
import {
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
import { cn } from "@/lib/utils";

import { formatTokens, formatUsdCell } from "../../metrics/lib/format.js";
import { formatSessionTimestamp } from "../lib/format-session-timestamp.js";
import { slackSessionKind } from "../lib/session-category.js";
import { WorkingDots } from "./working-dots.js";

const LONG_PRESS_MS = 400;

interface Props {
  session: SessionView;
  active: boolean;
  working: boolean;
  needsApproval: boolean;
  unread?: boolean;
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

  // Close menu on outside tap
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Show "(no title · abcd1234)" while the harness hasn't named the session
  // — the id suffix keeps untitled rows distinguishable from each other.
  const titleLabel = s.title || `(no title · ${s.sessionId.slice(0, 8)})`;
  const titleClass = !s.title
    ? "text-muted-foreground italic"
    : unread
      ? "font-semibold text-foreground"
      : "font-normal text-foreground";

  const scheduled = s.type === SessionType.ScheduleCron || !!s.scheduleId;
  const terminal = s.mode === SessionMode.Terminal;
  const channel =
    s.type === SessionType.ChannelSlack ||
    s.type === SessionType.ChannelTelegram;
  // Slack channel sessions split into the channel's rolling ambient reader and
  // the threads it spins off; the ambient one wears an extra "A" marker.
  const slackKind = slackSessionKind(s);

  return (
    <div
      data-testid="session-row"
      data-session-id={s.sessionId}
      data-active={active ? "true" : "false"}
      className={cn(
        "group relative flex items-center gap-1 px-4 py-3 cursor-pointer border-b border-border transition-colors select-none",
        active ? "bg-muted" : "hover:bg-muted/60",
      )}
      onClick={handleClick}
      onTouchStart={startPress}
      onTouchEnd={endPress}
      onTouchCancel={endPress}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className={`text-[13px] min-w-0 truncate ${titleClass}`}>
            {titleLabel}
          </span>
          <SessionIndicators
            scheduled={scheduled}
            terminal={terminal}
            channel={channel}
            ambient={slackKind === "ambient"}
            needsApproval={needsApproval}
            working={working}
          />
        </div>
        <span className="text-[11px] text-muted-foreground">
          {slackKind
            ? `${slackKind === "ambient" ? "Ambient" : "Thread"} · `
            : ""}
          {formatSessionTimestamp(s.updatedAt ?? s.createdAt)}
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
      {/* Desktop: hover-visible overflow menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            data-testid="session-menu-button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100"
            onClick={(e) => e.stopPropagation()}
            title="More actions"
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
      {/* Context menu — long press (mobile) or right-click */}
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
  channel,
  ambient,
  needsApproval,
  working,
}: {
  scheduled: boolean;
  terminal: boolean;
  channel: boolean;
  ambient: boolean;
  needsApproval: boolean;
  working: boolean;
}) {
  if (!scheduled && !terminal && !channel && !needsApproval && !working)
    return null;
  return (
    <span className="ml-auto flex items-center gap-1.5 shrink-0 pl-2">
      {terminal && (
        <Code size={16} className="text-foreground" aria-label="Terminal" />
      )}
      {channel &&
        (ambient ? (
          // Rolling channel reader: keep the # channel glyph, brand it with a
          // superscript "A" so it stands apart from the threads it spins off.
          <span
            className="inline-flex items-start text-foreground"
            aria-label="Ambient channel session"
          >
            <Hashtag size={16} />
            <span
              className="text-[9px] font-semibold leading-none text-accent"
              aria-hidden
            >
              A
            </span>
          </span>
        ) : (
          <Hashtag
            size={16}
            className="text-foreground"
            aria-label="Channel session"
          />
        ))}
      {scheduled && (
        <Time size={16} className="text-foreground" aria-label="Scheduled" />
      )}
      {needsApproval ? (
        <span
          data-testid="session-approval-dot"
          className="w-2 h-2 rounded-full bg-accent shrink-0"
          title="Needs your approval"
        />
      ) : working ? (
        <WorkingDots className="text-accent" title="Working" />
      ) : null}
    </span>
  );
}
