import { ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { useApprovalsForInstance } from "../api/queries.js";
import { ApprovalsList } from "./approvals-list.js";

const EMPTY: never[] = [];

export interface InstanceApprovalsTrayProps {
  instanceId: string | null;
}

/**
 * Pending-approvals tray rendered under the sessions list in the chat view's
 * left rail. Collapses to a single header row when there's nothing pending so
 * it doesn't crowd the sessions list; expands automatically when new pending
 * rows arrive on the polling interval.
 */
export function InstanceApprovalsTray({
  instanceId,
}: InstanceApprovalsTrayProps) {
  const { data: rows = EMPTY } = useApprovalsForInstance(instanceId);
  const pending = rows.filter((r) => r.status === "pending");
  const pendingCount = pending.length;
  const [open, setOpen] = useState(false);

  // Auto-open when something becomes pending; keep manual close sticky once
  // user collapses an empty tray.
  const effectiveOpen = open || pendingCount > 0;

  if (!instanceId) return null;

  return (
    <div className="shrink-0 border-t border-border-light bg-surface/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-4 h-9 text-left text-text-secondary hover:text-text transition-colors"
      >
        {effectiveOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <ShieldAlert
          size={12}
          className={pendingCount > 0 ? "text-accent" : "text-text-muted"}
        />
        <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">
          Approvals
        </span>
        {pendingCount > 0 && (
          <span className="ml-auto min-w-[18px] h-[18px] rounded-full bg-accent text-[10px] font-bold text-white flex items-center justify-center px-1.5">
            {pendingCount > 9 ? "9+" : pendingCount}
          </span>
        )}
      </button>
      {effectiveOpen && (
        <div className="max-h-[40vh] overflow-y-auto border-t border-border-light">
          <ApprovalsList
            rows={pending}
            density="compact"
            emptyLabel="Nothing pending"
          />
        </div>
      )}
    </div>
  );
}
