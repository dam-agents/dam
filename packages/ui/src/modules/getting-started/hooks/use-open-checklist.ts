import { useCallback } from "react";

import { useOpenSidePanel } from "../../sessions/hooks/use-open-side-panel.js";
import { useSetChecklistDismissed } from "../api/mutations.js";
import { useGettingStarted } from "../api/queries.js";

export function useOpenChecklist(): () => void {
  const dismissed = useGettingStarted().data?.dismissed ?? false;
  const openSidePanel = useOpenSidePanel();
  const setDismissed = useSetChecklistDismissed();
  return useCallback(() => {
    openSidePanel("getting-started");
    if (dismissed) setDismissed.mutate({ dismissed: false });
  }, [dismissed, openSidePanel, setDismissed]);
}
