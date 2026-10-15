import { Notification } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useWaitingApprovals } from "../hooks/use-waiting-approvals.js";

export function ApprovalsButton() {
  const waiting = useWaitingApprovals().length;
  const open = useStore((s) => s.approvalsOpen);
  const setOpen = useStore((s) => s.setApprovalsOpen);

  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      data-testid="open-approvals"
      aria-label={
        waiting > 0 ? `Approvals, ${String(waiting)} waiting` : "Approvals"
      }
      className={cn(
        "relative flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        open && "bg-muted text-foreground",
      )}
    >
      <Notification size={16} />
      {waiting > 0 && (
        <Badge
          data-testid="approvals-badge"
          className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full border-0 bg-warning px-1 text-[10px] font-bold text-white hover:bg-warning"
        >
          {waiting > 9 ? "9+" : waiting}
        </Badge>
      )}
    </button>
  );
}
