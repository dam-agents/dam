import { useDefaultModelNotices } from "../../home/hooks/use-default-model-notices.js";
import { useOutageAlerts } from "../../home/hooks/use-outage-alerts.js";
import { useWaitingApprovals } from "../../home/hooks/use-waiting-approvals.js";
import type { SidePanelTabProps } from "../components/side-panel-bar.js";

export function useAppSidePanelTabs(): Pick<SidePanelTabProps, "badges"> {
  const waiting =
    useWaitingApprovals().length +
    useDefaultModelNotices().waiting.length +
    useOutageAlerts().waiting.length;
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
