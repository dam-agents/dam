import { useCallback } from "react";

import { isMobile } from "../../../lib/breakpoints.js";
import { useStore } from "../../../store.js";

export const PROCESSES_SECTION_ID = "processes-section";

export function useOpenProcessesSection() {
  const setSectionOpen = useStore((s) => s.setProcessesSectionOpen);
  const setMobileScreen = useStore((s) => s.setMobileScreen);

  return useCallback(() => {
    setSectionOpen(true);
    if (isMobile()) setMobileScreen("sessions");
    requestAnimationFrame(() =>
      document
        .getElementById(PROCESSES_SECTION_ID)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }, [setSectionOpen, setMobileScreen]);
}
