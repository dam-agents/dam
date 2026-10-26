import { useCallback } from "react";

import { useIsDesktop } from "../../../hooks/use-is-desktop.js";
import { useStore } from "../../../store.js";
import { GettingStartedDock } from "../../getting-started/components/getting-started-dock.js";
import { ApprovalsDrawer } from "../../home/components/approvals-panel.js";
import { AppSidePanelButtons } from "../../sessions/components/app-side-panel.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The right edge of a page: the Get started ring
 * and the approvals bell in the page's own top corner. The ring opens the Get
 * started checklist as a dock that floats under it, and the bell opens
 * Approvals as a drawer over the page, so no icon column takes room beside the
 * page. The drawer reads the side panel's tab, so a phone's top bar opens it
 * the same way. A phone's top bar holds the ring, so this row leaves it out
 * there: its dock would float over the page twice.
 */
export function ClassicPageActions() {
  const desktop = useIsDesktop();
  return (
    <div className="pointer-events-none sticky top-0 z-raised hidden justify-end px-4 pt-3 md:flex md:px-6">
      <div className="pointer-events-auto flex items-center gap-1">
        {desktop && <GettingStartedDock placement="page" />}
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
  return null;
}
