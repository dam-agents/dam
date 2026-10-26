import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { GettingStartedDock } from "../../getting-started/components/getting-started-dock.js";
import { ApprovalsDrawer } from "../../home/components/approvals-panel.js";
import { AppSidePanelButtons } from "../../sessions/components/app-side-panel.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The right edge of a page. The approvals bell and,
 * on an Agent's configuration page, Artifacts sit in the page's own top corner
 * row, and the bell opens Approvals as a drawer over the page, so no icon
 * column takes room beside it. The Get started ring hangs under that row, out
 * of its flow, so the row keeps no place for it and the page scrolls under it;
 * its dock opens under the ring. The drawer reads the side panel's tab, so a
 * phone opens it the same way. The row shows on a wide screen only, so a phone
 * carries the ring in the page's top bar instead.
 */
export function ClassicPageActions() {
  return (
    <div className="pointer-events-none sticky top-0 z-raised hidden justify-end px-4 pt-3 md:flex md:px-6">
      <div className="pointer-events-auto flex items-center gap-1">
        <AppSidePanelButtons onDesktop withArtifacts />
      </div>
      <div className="pointer-events-auto absolute top-[46px] right-4 md:right-6">
        <GettingStartedDock placement="corner" />
      </div>
    </div>
  );
}

export function ClassicPagePanels() {
  const sidePanelTab = useStore((s) => s.sidePanelTab);
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const close = useCallback(() => setSidePanelTab(null), [setSidePanelTab]);
  if (sidePanelTab === "approvals") return <ApprovalsDrawer onClose={close} />;
  return null;
}
