import { useCallback } from "react";

import { useIsDesktop } from "../../../hooks/use-is-desktop.js";
import { useStore } from "../../../store.js";
import { useSetChecklistDismissed } from "../api/mutations.js";
import { useGettingStarted } from "../api/queries.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Every surface that offers the
 * checklist without being the sidebar — the avatar picker and the command
 * palette — asks here, so each one clears a dismissal, brings the item on
 * screen and opens the checklist in that order. On a phone the item lives in
 * the navigation drawer, so the drawer opens first; opening the checklist
 * alone would anchor its popover to a trigger nobody can see.
 */
export function useOpenChecklist(): () => void {
  const dismissed = useGettingStarted().data?.dismissed ?? false;
  const wide = useIsDesktop();
  const setExpanded = useStore((s) => s.setChecklistExpanded);
  const setMobileNavOpen = useStore((s) => s.setMobileNavOpen);
  const setDismissed = useSetChecklistDismissed();
  return useCallback(() => {
    if (dismissed) setDismissed.mutate({ dismissed: false });
    if (!wide) setMobileNavOpen(true);
    setExpanded(true);
  }, [dismissed, wide, setDismissed, setMobileNavOpen, setExpanded]);
}
