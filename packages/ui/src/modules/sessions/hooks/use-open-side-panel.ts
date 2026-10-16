import { useCallback } from "react";

import { isMobile } from "../../../lib/breakpoints.js";
import { useStore } from "../../../store.js";
import type { SidePanelTab } from "../lib/side-panel.js";

export function useOpenSidePanel(): (tab: SidePanelTab) => void {
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  return useCallback(
    (tab) => {
      setSidePanelTab(tab);
      if (isMobile()) setMobileScreen("files");
    },
    [setSidePanelTab, setMobileScreen],
  );
}
