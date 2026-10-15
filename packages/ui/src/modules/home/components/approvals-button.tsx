import { Notification } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";

import { useWaitingApprovals } from "../hooks/use-waiting-approvals.js";

export function ApprovalsButton({ onOpen }: { onOpen: () => void }) {
  const waiting = useWaitingApprovals().length;

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="open-approvals"
      aria-label={
        waiting > 0 ? `Approvals, ${String(waiting)} waiting` : "Approvals"
      }
      className="relative flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
