import { ChevronRight, Warning } from "@carbon/icons-react";

import { useOpenSidePanel } from "../../sessions/hooks/use-open-side-panel.js";
import { useDefaultModelNotices } from "../hooks/use-default-model-notices.js";
import { useWaitingApprovals } from "../hooks/use-waiting-approvals.js";
import { approvalsBannerCopy } from "../lib/approval-copy.js";
import { defaultModelStopsRuns } from "../lib/default-model-copy.js";

export function ApprovalsBanner() {
  const openSidePanel = useOpenSidePanel();
  const approvals = useWaitingApprovals();
  const notices = useDefaultModelNotices().waiting.filter(
    defaultModelStopsRuns,
  );
  if (approvals.length === 0 && notices.length === 0) return null;
  const needDefault = `${String(notices.length)} ${notices.length === 1 ? "agent needs" : "agents need"} a default model`;
  const approvalsCopy =
    approvals.length > 0 ? approvalsBannerCopy(approvals) : null;
  const { title, detail } = approvalsCopy
    ? {
        title: approvalsCopy.title,
        detail:
          notices.length > 0
            ? `${approvalsCopy.detail} · ${needDefault}`
            : approvalsCopy.detail,
      }
    : {
        title: needDefault,
        detail:
          "Their schedules and Slack or Telegram turns won't run until you choose one",
      };

  return (
    <button
      type="button"
      onClick={() => openSidePanel("approvals")}
      data-testid="approvals-banner"
      className="mb-6 flex w-full items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-left transition-colors hover:bg-warning/10 dark:border-warning/20 dark:bg-warning/10 dark:hover:bg-warning/15"
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
