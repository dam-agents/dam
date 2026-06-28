import { Plus, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";

import type { SessionNavProps } from "./types.js";

export function SessionTabs({
  sessions,
  activeSessionId,
  loading,
  pendingPermissions,
  onResume,
  onNew,
  onDelete,
}: Omit<SessionNavProps, "onRename" | "onViewLogs" | "onRefresh">) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, sid: string) => {
      e.preventDefault();
      setMenuOpenId(menuOpenId === sid ? null : sid);
    },
    [menuOpenId],
  );

  return (
    <div className="flex items-center h-11 px-3 border-b border-border bg-muted/30 shrink-0 relative">
      <button
        onClick={onNew}
        className="mr-1 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium bg-background text-foreground shadow-sm border border-border hover:bg-muted/60 transition-colors shrink-0"
        title="New session"
      >
        <Plus size={13} />
        <span>New</span>
      </button>

      <div className="flex flex-1 items-center gap-1 overflow-x-auto scrollbar-hide">
        {sessions.map((s) => {
          const isActive = s.sessionId === activeSessionId;
          const hasPending = pendingPermissions.some(
            (p) => p.sessionId === s.sessionId,
          );
          const title = s.title || `Session ${s.sessionId.slice(0, 6)}`;

          return (
            <div key={s.sessionId} className="relative group shrink-0">
              <button
                onClick={() => onResume(s.sessionId)}
                onContextMenu={(e) => handleContextMenu(e, s.sessionId)}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-[13px] font-medium transition-all max-w-[180px] ${
                  isActive
                    ? "bg-background text-foreground shadow-sm border border-border"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                }`}
              >
                {hasPending && (
                  <span className="w-2 h-2 rounded-full bg-warning shrink-0" />
                )}
                <span className="truncate">{title}</span>
                {isActive && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(s.sessionId, s.title);
                    }}
                    className="ml-1 h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={12} />
                  </button>
                )}
              </button>

              {menuOpenId === s.sessionId && (
                <div className="absolute top-full left-0 z-30 mt-1 rounded-lg border border-border bg-card py-1 shadow-md anim-scale-in">
                  <button
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-destructive hover:bg-destructive/10 transition-colors"
                    onClick={() => {
                      setMenuOpenId(null);
                      onDelete(s.sessionId, s.title);
                    }}
                  >
                    <Trash2 size={11} /> Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {loading && (
          <span className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 border-t-primary anim-spin shrink-0 ml-2" />
        )}
      </div>
    </div>
  );
}
