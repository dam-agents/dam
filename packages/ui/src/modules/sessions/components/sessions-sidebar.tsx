import { SessionType } from "api-server-api";
import { ArrowLeft, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useStore } from "../../../store.js";
import { InstanceApprovalsTray } from "../../approvals/components/instance-approvals-tray.js";
import { useInstancesList } from "../../instances/api/queries.js";
import { useAcpSessions } from "../api/queries.js";

export function SessionsSidebar({
  onResumeSession,
  onNewSession,
}: {
  onResumeSession: (sid: string) => void;
  onNewSession: () => void;
}) {
  const selectedInstance = useStore((s) => s.selectedInstance);
  const sessionId = useStore((s) => s.sessionId);
  const pendingPermissions = useStore((s) => s.pendingPermissions);
  const includeChannel = useStore((s) => s.includeChannelSessions);
  const setIncludeChannel = useStore((s) => s.setIncludeChannelSessions);
  const deleteSession = useStore((s) => s.deleteSession);
  const showConfirm = useStore((s) => s.showConfirm);
  const goBack = useStore((s) => s.goBack);

  const instances = useInstancesList();
  const instanceRunState = instances.find((i) => i.id === selectedInstance)?.state;
  const { data: sessions = [], isFetching, refetch } = useAcpSessions(
    selectedInstance,
    includeChannel,
    { enabled: instanceRunState === "running" },
  );
  const loading = isFetching;

  const confirmDelete = useCallback(
    async (sid: string, title: string | null | undefined) => {
      const label = title || sid.slice(0, 12);
      if (await showConfirm(`Delete session "${label}"?`, "Delete Session")) {
        deleteSession(sid);
      }
    },
    [showConfirm, deleteSession],
  );

  return (
    <>
      <div className="flex items-center justify-between px-4 h-11 border-b border-border-light shrink-0 relative">
        {/* Mobile: back to agents */}
        <button
          className="md:hidden h-6 w-6 rounded-md flex items-center justify-center text-text-muted hover:text-accent transition-colors mr-2"
          onClick={goBack}
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">
          Sessions
        </span>
        <button
          className={`ml-auto h-6 w-6 rounded-md border border-border-light flex items-center justify-center text-text-muted hover:text-accent hover:border-accent transition-colors`}
          onClick={() => refetch()}
        >
          <span className={loading ? "anim-spin" : ""}>
            <RefreshCw size={11} />
          </span>
        </button>
        {loading && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent/20 overflow-hidden">
            <div className="h-full w-1/3 bg-accent rounded-full anim-slide" />
          </div>
        )}
      </div>
      <div className="px-4 py-2 border-b border-border-light">
        <label className="flex items-center gap-2 cursor-pointer text-[11px] text-text-muted">
          <input
            type="checkbox"
            checked={includeChannel}
            onChange={(e) => setIncludeChannel(e.target.checked)}
            className="accent-accent w-3 h-3"
          />
          Show channel sessions
        </label>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!loading && sessions.length === 0 && (
          <p className="px-4 py-5 text-[12px] text-text-muted">
            No sessions yet
          </p>
        )}
        {sessions.map((s) => (
          <SessionRow
            key={s.sessionId}
            session={s}
            active={s.sessionId === sessionId}
            hasPending={pendingPermissions.some((p) => p.sessionId === s.sessionId)}
            onResume={() => onResumeSession(s.sessionId)}
            onDelete={() => confirmDelete(s.sessionId, s.title)}
          />
        ))}
      </div>
      <InstanceApprovalsTray instanceId={selectedInstance} />
      <div className="px-3 py-3 border-t border-border-light shrink-0">
        <button
          className="w-full h-9 rounded-md border border-border-light text-[12px] font-semibold text-text-secondary hover:text-accent hover:border-accent flex items-center justify-center gap-1.5 transition-colors"
          onClick={onNewSession}
        >
          <Plus size={13} /> New Session
        </button>
      </div>
    </>
  );
}

const LONG_PRESS_MS = 400;

function SessionRow({
  session: s,
  active,
  hasPending,
  onResume,
  onDelete,
}: {
  session: {
    sessionId: string;
    title?: string | null;
    type: string;
    createdAt: string;
    updatedAt?: string | null;
  };
  active: boolean;
  hasPending: boolean;
  onResume: () => void;
  onDelete: () => void;
}) {
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
          <span
            className={`text-[13px] truncate ${active ? "text-accent font-bold" : "text-text font-medium"}`}
          >
            {s.title || s.sessionId.slice(0, 12)}
          </span>
          {(s.type === SessionType.ChannelSlack || s.type === SessionType.ChannelTelegram) && (
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
      <button
        className="shrink-0 h-6 w-6 rounded-md flex items-center justify-center text-text-muted opacity-0 group-hover:opacity-100 hover:text-danger transition-all"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete session"
      >
        <Trash2 size={12} />
      </button>
      {/* Context menu — long press (mobile) or right-click */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-3 top-2 z-30 rounded-lg border-2 border-border bg-surface py-1 anim-scale-in shadow-brutal-sm"
        >
          <button
            className="flex items-center gap-2 w-full px-4 py-2 text-[13px] text-danger hover:bg-danger-light transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={13} /> Delete session
          </button>
        </div>
      )}
    </div>
  );
}
