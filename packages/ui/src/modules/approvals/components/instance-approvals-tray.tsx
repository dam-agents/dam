import {
  ChevronDown,
  ChevronRight,
  WarningAlt as ShieldAlert,
} from "@carbon/icons-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
export function InstanceApprovalsTray({ instanceId }: InstanceApprovalsTrayProps) {
  const { data: rows = EMPTY } = useApprovalsForInstance(instanceId);
  const pending = rows.filter((r) => r.status === "pending");
  const pendingCount = pending.length;
  const [open, setOpen] = useState(false);

  // Auto-open when something becomes pending; keep manual close sticky once
  // user collapses an empty tray.
  const effectiveOpen = open || pendingCount > 0;

  if (!instanceId) return null;

  return (
    <div className="shrink-0 border-t border-border bg-card/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-4 h-9 text-left text-foreground/80 hover:text-foreground transition-colors"
      >
        {effectiveOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <ShieldAlert
          size={12}
          className={cn(pendingCount > 0 ? "text-primary" : "text-muted-foreground")}
        />
        <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
          Approvals
        </span>
        {pendingCount > 0 && (
          <Badge
            variant="default"
            className="ml-auto min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1.5 border-0"
          >
            {pendingCount > 9 ? "9+" : pendingCount}
          </Badge>
        )}
      </button>
      {effectiveOpen && (
        <div className="max-h-[40vh] overflow-y-auto border-t border-border">
          <ApprovalsList rows={pending} density="compact" emptyLabel="Nothing pending" />
        </div>
      )}
    </div>
  );
}
