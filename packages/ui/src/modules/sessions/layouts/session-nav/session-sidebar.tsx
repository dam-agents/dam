import { OverflowMenuVertical, Time } from "@carbon/icons-react";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { SessionNavProps } from "./types.js";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  loading,
  pendingPermissions,
  onResume,
  onNew,
  onDelete,
  onRename,
  onViewLogs,
}: SessionNavProps) {
  const confirmDelete = useCallback(
    (e: React.MouseEvent, sid: string, title?: string | null) => {
      e.stopPropagation();
      onDelete(sid, title);
    },
    [onDelete],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-3.5 h-11 border-b border-border shrink-0">
        <span className="text-[14px] font-semibold text-foreground">
          Sessions
        </span>
        <button
          onClick={onNew}
          className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border text-[12px] font-medium text-foreground hover:bg-muted/50 transition-colors"
        >
          <Plus size={12} />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!loading && sessions.length === 0 && (
          <p className="px-2.5 py-4 text-[11px] text-muted-foreground">
            No sessions yet
          </p>
        )}
        {sessions.map((s) => {
          const isActive = s.sessionId === activeSessionId;
          const hasPending = pendingPermissions.some(
            (p) => p.sessionId === s.sessionId,
          );
          const title = s.title || `${s.sessionId.slice(0, 8)}`;
          const isScheduled = s.type === "schedule_cron";
          const isTerminal = s.mode === "terminal";
          const isUnread =
            s.sessionId === "sess-003" || s.sessionId === "sess-006";
          const isWorking = s.sessionId === "sess-005";

          return (
            <div
              key={s.sessionId}
              className={`group relative px-3.5 py-2.5 cursor-pointer border-b border-border/50 transition-colors ${
                isActive ? "bg-[#f2f4f8]" : "hover:bg-muted/50"
              }`}
              onClick={() => onResume(s.sessionId)}
            >
              <div className="flex items-center gap-1.5">
                {hasPending && (
                  <span className="w-2 h-2 rounded-full bg-[#0f62fe] shrink-0" />
                )}
                {isScheduled && (
                  <Time size={12} className="text-muted-foreground shrink-0" />
                )}
                <span
                  className={`text-[13px] truncate flex-1 ${
                    isTerminal
                      ? "text-muted-foreground"
                      : isUnread
                        ? "font-semibold text-foreground/80"
                        : "text-foreground/80"
                  }`}
                >
                  {title}
                  {isTerminal && (
                    <span className="text-muted-foreground"> (Terminal)</span>
                  )}
                  {isWorking && (
                    <span className="ml-1 inline-flex gap-[2px]">
                      <span className="w-[3px] h-[3px] rounded-full bg-foreground/60 animate-bounce [animation-delay:0ms]" />
                      <span className="w-[3px] h-[3px] rounded-full bg-foreground/60 animate-bounce [animation-delay:150ms]" />
                      <span className="w-[3px] h-[3px] rounded-full bg-foreground/60 animate-bounce [animation-delay:300ms]" />
                    </span>
                  )}
                </span>

                {/* Overflow menu — always visible on active, hover otherwise */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-6 w-6 shrink-0 text-muted-foreground transition-opacity ${
                        isActive
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <OverflowMenuVertical size={14} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onRename(s.sessionId, s.title);
                      }}
                    >
                      <Pencil size={14} />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewLogs(s.sessionId);
                      }}
                    >
                      <FileText size={14} />
                      View logs
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={(e) => confirmDelete(e, s.sessionId, s.title)}
                    >
                      <Trash2 size={14} />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <span className="text-[11px] text-muted-foreground mt-0.5 block">
                {formatDate(s.updatedAt ?? s.createdAt)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
