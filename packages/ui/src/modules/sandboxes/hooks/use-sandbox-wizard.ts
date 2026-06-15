import { useCallback, useState } from "react";

import {
  clearSnapshot,
  EMPTY_SNAPSHOT,
  loadSnapshot,
  saveSnapshot,
  type WizardSnapshot,
} from "../lib/wizard-snapshot.js";

export interface SandboxWizard {
  snapshot: WizardSnapshot;
  update: (patch: Partial<WizardSnapshot>) => void;
  reset: () => void;
}

export function useSandboxWizard(): SandboxWizard {
  const [snapshot, setSnapshot] = useState<WizardSnapshot>(loadSnapshot);

  const update = useCallback((patch: Partial<WizardSnapshot>) => {
    setSnapshot((prev) => {
      const next = { ...prev, ...patch };
      saveSnapshot(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    clearSnapshot();
    setSnapshot(EMPTY_SNAPSHOT);
  }, []);

  return { snapshot, update, reset };
}
