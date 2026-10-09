import { ChevronRight, Warning } from "@carbon/icons-react";

import { useStore } from "../../../store.js";
import { useWaitingApprovals } from "../hooks/use-waiting-approvals.js";
import { approvalsBannerCopy } from "../lib/approval-copy.js";

export function ApprovalsBanner() {
  const setActivityView = useStore((s) => s.setActivityView);
  const approvals = useWaitingApprovals();
  if (approvals.length === 0) return null;
  const { title, detail } = approvalsBannerCopy(approvals);

  return (
    <button
      type="button"
      onClick={() => setActivityView("feed")}
      data-testid="approvals-banner"
      className="mb-6 flex w-full items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-left transition-colors hover:bg-warning/10 dark:border-warning/20 dark:bg-warning/10 dark:hover:bg-warning/15"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 dark:bg-warning/20">
        <Warning size={16} className="text-warning" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
    </button>
  );
}
