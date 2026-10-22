import { useNewLayout } from "../../features/hooks/use-new-layout.js";
import { useGettingStarted } from "../../getting-started/api/queries.js";
import {
  ProgressRing,
  SmileRing,
} from "../../getting-started/components/progress-ring.js";
import { deriveChecklist } from "../../getting-started/lib/derive-checklist.js";
import { useDefaultModelNotices } from "../../home/hooks/use-default-model-notices.js";
import { useWaitingApprovals } from "../../home/hooks/use-waiting-approvals.js";
import type { SidePanelTabProps } from "../components/side-panel-bar.js";

export function useAppSidePanelTabs(): Pick<
  SidePanelTabProps,
  "badges" | "icons"
> & { gettingStarted: boolean } {
  const progress = useGettingStarted().data;
  const waiting =
    useWaitingApprovals().length + useDefaultModelNotices().waiting.length;
  const checklist = progress ? deriveChecklist(progress) : null;
  const unseen = progress?.unlocks.filter((u) => !u.seen).length ?? 0;
  const Ring = useNewLayout() ? SmileRing : ProgressRing;
  return {
    gettingStarted:
      checklist !== null &&
      !checklist.complete &&
      (!checklist.dismissed || checklist.celebrating !== null),
    icons: checklist
      ? {
          "getting-started": (
            <Ring
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
        label: `Approvals, ${String(waiting)} need you`,
        tone: "warning",
      },
    },
  };
}
