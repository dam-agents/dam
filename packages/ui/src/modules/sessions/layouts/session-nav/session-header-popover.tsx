import { ChevronDown, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type { SessionNavProps } from "./types.js";

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return new Date(dateStr).toLocaleDateString();
}

export function SessionHeaderPopover({
  sessions,
  activeSessionId,
  loading,
  pendingPermissions,
  onResume,
  onNew,
  onDelete,
  onRefresh,
}: Omit<SessionNavProps, "onRename" | "onViewLogs">) {
  const [open, setOpen] = useState(false);

  const activeSession = sessions.find((s) => s.sessionId === activeSessionId);
  const triggerLabel =
    activeSession?.title ??
    (activeSessionId
      ? `Session ${activeSessionId.slice(0, 6)}`
      : "New session");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="ml-3 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all max-w-[200px]">
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown size={12} className="shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[300px] p-0 max-h-[400px] flex flex-col"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          <span className="text-[12px] font-medium text-muted-foreground">
            Sessions
          </span>
          <div className="flex items-center gap-1">
            <button
              className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              onClick={onRefresh}
            >
              <span className={loading ? "anim-spin" : ""}>
                <RefreshCw size={10} />
              </span>
            </button>
            <button
              className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => {
                onNew();
                setOpen(false);
              }}
              title="New session"
            >
              <Plus size={10} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!loading && sessions.length === 0 && (
            <p className="px-3 py-4 text-[11px] text-muted-foreground text-center">
              No sessions yet. Send a message to start one.
            </p>
          )}
          {sessions.map((s) => {
            const isActive = s.sessionId === activeSessionId;
            const hasPending = pendingPermissions.some(
              (p) => p.sessionId === s.sessionId,
            );
            const title = s.title || `Session ${s.sessionId.slice(0, 8)}`;

            return (
              <div
                key={s.sessionId}
                className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                  isActive ? "bg-muted" : "hover:bg-muted/50"
                }`}
                onClick={() => {
                  onResume(s.sessionId);
                  setOpen(false);
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {hasPending && (
                      <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
                    )}
                    <span
                      className={`text-[13px] truncate ${
                        isActive
                          ? "font-semibold text-foreground"
                          : "text-foreground/80"
                      }`}
                    >
                      {title}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {relativeTime(s.updatedAt ?? s.createdAt)}
                  </span>
                </div>
                <button
                  className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.sessionId, s.title);
                  }}
                  title="Delete"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
