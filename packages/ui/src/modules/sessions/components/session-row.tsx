import { Code } from "@carbon/icons-react";
import { SessionMode, SessionType, type SessionView } from "api-server-api";
import { Clock, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { WorkingDots } from "./working-dots.js";

const LONG_PRESS_MS = 400;

interface Props {
  session: SessionView;
  active: boolean;
  working: boolean;
  needsApproval: boolean;
  unread?: boolean;
  onResume: () => void;
  onDelete: () => void;
}

export function SessionRow({
  session: s,
  active,
  working,
  needsApproval,
  unread = false,
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
    ? "text-text-muted italic"
    : unread
      ? "font-semibold text-text"
      : "font-normal text-text";

  const scheduled = s.type === SessionType.ScheduleCron || !!s.scheduleId;
  const terminal = s.mode === SessionMode.Terminal;

  return (
    <div
      data-testid="session-row"
      data-session-id={s.sessionId}
      data-active={active ? "true" : "false"}
      className={cn(
        "group relative flex items-center gap-1 px-4 py-3 cursor-pointer border-b border-border-light transition-colors select-none",
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
          {(s.type === SessionType.ChannelSlack ||
            s.type === SessionType.ChannelTelegram) && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted bg-border-light rounded px-1 py-0.5 shrink-0">
              {s.type === SessionType.ChannelSlack ? "slack" : "telegram"}
            </span>
          )}
          <SessionIndicators
            scheduled={scheduled}
            terminal={terminal}
            needsApproval={needsApproval}
            working={working}
          />
        </div>
        <span className="text-[11px] text-text-muted">
          {new Date(s.updatedAt ?? s.createdAt).toLocaleString()}
        </span>
      </div>
      {/* Desktop: hover-visible delete button */}
      <Button
        data-testid="session-delete-button"
        variant="ghost"
        tone="danger"
        size="icon-xs"
        className="shrink-0 opacity-0 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete session"
      >
        <Trash2 size={12} />
      </Button>
      {/* Context menu — long press (mobile) or right-click */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-3 top-2 z-30 rounded-lg border border-border bg-surface py-1 anim-scale-in shadow-md"
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
            <Trash2 size={13} /> Delete session
          </Button>
        </div>
      )}
    </div>
  );
}

function SessionIndicators({
  scheduled,
  terminal,
  needsApproval,
  working,
}: {
  scheduled: boolean;
  terminal: boolean;
  needsApproval: boolean;
  working: boolean;
}) {
  if (!scheduled && !terminal && !needsApproval && !working) return null;
  return (
    <span className="ml-auto flex items-center gap-1.5 shrink-0 pl-2">
      {terminal && (
        <Code size={16} className="text-text" aria-label="Terminal" />
      )}
      {scheduled && (
        <Clock size={16} className="text-text" aria-label="Scheduled" />
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
