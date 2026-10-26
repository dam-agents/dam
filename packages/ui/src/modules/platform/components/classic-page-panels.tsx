import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { GettingStartedDrawer } from "../../getting-started/components/getting-started-panel.js";
import { ApprovalsDrawer } from "../../home/components/approvals-panel.js";
import { AppSidePanelButtons } from "../../sessions/components/app-side-panel.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The right edge of a page: the Get started ring
 * and the approvals bell in the page's own top corner, and the two panels they
 * open as drawers over the page, so no icon column takes room beside the page.
 * The drawers read the side panel's tab, so a phone's top bar and the avatar
 * picker open them the same way.
 */
export function ClassicPageActions() {
  return (
    <div className="pointer-events-none sticky top-0 z-raised hidden justify-end px-4 pt-3 md:flex md:px-6">
      <div className="pointer-events-auto flex items-center gap-1">
        <AppSidePanelButtons onDesktop withArtifacts />
      </div>
    </div>
  );
}

export function ClassicPagePanels() {
  const sidePanelTab = useStore((s) => s.sidePanelTab);
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const close = useCallback(() => setSidePanelTab(null), [setSidePanelTab]);
  if (sidePanelTab === "approvals") return <ApprovalsDrawer onClose={close} />;
  if (sidePanelTab === "getting-started")
    return <GettingStartedDrawer onClose={close} />;
  return null;
}
