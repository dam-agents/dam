import { Inbox } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
        className={`flex items-center gap-2.5 rounded-lg transition-colors h-9 w-full ${collapsed ? "justify-center px-0" : "px-2.5"} ${active ? "text-accent bg-accent-light" : "text-text-secondary hover:text-text hover:bg-surface-raised"}`}
      >
        <span className="relative shrink-0">
          <Inbox size={18} />
          {pendingCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-accent text-[10px] font-bold text-white flex items-center justify-center">
              {pendingCount > 9 ? "9+" : pendingCount}
            </span>
          )}
        </span>
        {!collapsed && <span className="text-[14px] font-medium">Inbox</span>}
      </button>
      {open && (
        <div className="absolute left-full ml-2 bottom-0 z-40 w-[320px] rounded-lg border border-border bg-surface shadow-brutal-sm overflow-hidden anim-scale-in">
          <div className="px-3 py-2 border-b border-border-light flex items-center justify-between">
            <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">
              Inbox
            </span>
            <span className="text-[10px] text-text-muted">
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
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setView("inbox");
            }}
            className="w-full h-9 border-t border-border-light text-[12px] font-semibold text-accent hover:bg-accent-light transition-colors"
          >
            See all
          </button>
        </div>
      )}
    </div>
  );
}
