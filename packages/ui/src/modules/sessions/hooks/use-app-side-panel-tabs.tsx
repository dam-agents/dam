import { useAttention } from "../../home/api/queries.js";
import { useDefaultModelNotices } from "../../home/hooks/use-default-model-notices.js";
import { useOutageAlerts } from "../../home/hooks/use-outage-alerts.js";
import { useWaitingApprovals } from "../../home/hooks/use-waiting-approvals.js";
import { ownerQuestionGroups } from "../../home/lib/owner-question-groups.js";
import type { SidePanelTabProps } from "../components/side-panel-bar.js";

export function useAppSidePanelTabs(): Pick<SidePanelTabProps, "badges"> {
  const attention = useAttention().data;
  const waiting =
    useWaitingApprovals().length +
    useDefaultModelNotices().waiting.length +
    useOutageAlerts().waiting.length +
    ownerQuestionGroups(attention?.ownerQuestions ?? []).length +
    ((attention?.costReviews.length ?? 0) > 0 ? 1 : 0);
  return {
    badges: {
      approvals: {
        count: waiting,
        label: `Approvals, ${String(waiting)} need you`,
        tone: "warning",
      },
    },
  };
}
