import { useGettingStarted } from "../../getting-started/api/queries.js";
import { ProgressRing } from "../../getting-started/components/progress-ring.js";
import { deriveChecklist } from "../../getting-started/lib/derive-checklist.js";
import { useWaitingApprovals } from "../../home/hooks/use-waiting-approvals.js";
import type { SidePanelTabProps } from "../components/side-panel-bar.js";

export function useAppSidePanelTabs(): Pick<
  SidePanelTabProps,
  "badges" | "icons"
> & { gettingStarted: boolean } {
  const progress = useGettingStarted().data;
  const waiting = useWaitingApprovals().length;
  const checklist = progress ? deriveChecklist(progress) : null;
  const unseen = progress?.unlocks.filter((u) => !u.seen).length ?? 0;
  return {
    gettingStarted:
      checklist !== null &&
      !checklist.complete &&
      (!checklist.dismissed || checklist.celebrating !== null),
    icons: checklist
      ? {
          "getting-started": (
            <ProgressRing
              done={checklist.unlocked.length}
              total={checklist.rows.length}
            />
          ),
        }
      : {},
    badges: {
      "getting-started": {
        count: unseen,
        label: `Get started, ${String(unseen)} new avatar${unseen === 1 ? "" : "s"}`,
      },
      approvals: {
        count: waiting,
        label: `Approvals, ${String(waiting)} waiting`,
        tone: "warning",
      },
    },
  };
}
