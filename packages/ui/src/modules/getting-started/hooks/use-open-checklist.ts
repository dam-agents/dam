import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { useSetChecklistDismissed } from "../api/mutations.js";
import { useGettingStarted } from "../api/queries.js";

export function useOpenChecklist(): () => void {
  const dismissed = useGettingStarted().data?.dismissed ?? false;
  const setExpanded = useStore((s) => s.setChecklistExpanded);
  const setDismissed = useSetChecklistDismissed();
  return useCallback(() => {
    setExpanded(true);
    if (dismissed) setDismissed.mutate({ dismissed: false });
  }, [dismissed, setExpanded, setDismissed]);
}
