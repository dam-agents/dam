import { SessionMode, SessionType, type SessionView } from "api-server-api";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

const LONG_PRESS_MS = 400;

interface Props {
  session: SessionView;
  active: boolean;
  hasPending: boolean;
  onResume: () => void;
  onDelete: () => void;
}

export function SessionRow({
  session: s,
  active,
  hasPending,
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
  const titleClass = s.title
    ? active
      ? "text-accent font-bold"
      : "text-text font-medium"
    : "text-text-muted italic";

  return (
    <div
      className={`group relative flex items-center gap-1 px-4 py-3 cursor-pointer border-b border-border-light transition-colors hover:bg-accent-light select-none ${active ? "bg-accent-light border-l-[3px] border-l-accent" : ""}`}
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
          {hasPending && (
            <span
              className="w-2 h-2 rounded-full bg-warning anim-pulse shrink-0"
              title="Pending permission request"
            />
          )}
          <span className={`text-[13px] truncate ${titleClass}`}>
            {titleLabel}
          </span>
          {s.mode === SessionMode.Terminal && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-accent bg-accent-light rounded px-1 py-0.5 shrink-0">
              terminal
            </span>
          )}
          {(s.type === SessionType.ChannelSlack ||
            s.type === SessionType.ChannelTelegram) && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted bg-border-light rounded px-1 py-0.5 shrink-0">
              {s.type === SessionType.ChannelSlack ? "slack" : "telegram"}
            </span>
          )}
        </div>
        <span className="text-[11px] text-text-muted">
          {new Date(s.updatedAt ?? s.createdAt).toLocaleString()}
        </span>
      </div>
      {/* Desktop: hover-visible delete button */}
      <Button
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
