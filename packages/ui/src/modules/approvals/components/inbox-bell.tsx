import { Email as Inbox } from "@carbon/icons-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useApprovalsForOwner } from "../api/queries.js";
import { ApprovalsList } from "./approvals-list.js";

const EMPTY: never[] = [];
const COMPACT_LIMIT = 5;

export interface InboxBellProps {
  /** Match the sidebar's icon-only mode. */
  collapsed: boolean;
}

export function InboxBell({ collapsed }: InboxBellProps) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  const { data: rows = EMPTY } = useApprovalsForOwner();
  const pending = rows.filter((r) => r.status === "pending");
  const pendingCount = pending.length;
  const compactRows = pending.slice(0, COMPACT_LIMIT);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const active = view === "inbox";

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={collapsed ? "Inbox" : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-lg transition-colors h-9 w-full overflow-hidden",
          collapsed ? "justify-center px-0" : "justify-start px-2.5",
          active
            ? "text-primary bg-primary/10"
            : "text-foreground/80 hover:text-foreground hover:bg-muted",
        )}
      >
        <span className="relative shrink-0">
          <Inbox size={18} />
          {pendingCount > 0 && (
            <Badge
              variant="default"
              className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center border-0"
            >
              {pendingCount > 9 ? "9+" : pendingCount}
            </Badge>
          )}
        </span>
        {!collapsed && (
          <span className="text-[14px] font-medium whitespace-nowrap">
            Inbox
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-full ml-2 bottom-0 z-40 w-[320px] rounded-lg border border-input bg-card shadow-sm overflow-hidden anim-scale-in">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
              Inbox
            </span>
            <span className="text-[10px] text-muted-foreground">
              {pendingCount} pending
            </span>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            <ApprovalsList
              rows={compactRows}
              density="compact"
              emptyLabel="Nothing pending"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              setView("inbox");
            }}
            className="w-full h-9 border-t border-border rounded-none text-[12px] font-semibold text-primary hover:bg-primary/10"
          >
            See all
          </Button>
        </div>
      )}
    </div>
  );
}
