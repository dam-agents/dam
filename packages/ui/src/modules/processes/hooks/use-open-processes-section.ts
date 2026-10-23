import { useCallback } from "react";

import { isMobile } from "../../../lib/breakpoints.js";
import { useStore } from "../../../store.js";

export function useOpenProcessesSection() {
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const setSectionOpen = useStore((s) => s.setProcessesSectionOpen);
  const setMobileScreen = useStore((s) => s.setMobileScreen);

  return useCallback(() => {
    setSidePanelTab("processes");
    setSectionOpen(true);
    if (isMobile()) setMobileScreen("files");
  }, [setSidePanelTab, setSectionOpen, setMobileScreen]);
}
