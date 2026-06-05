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

/**
 * Snapshot-backed wizard state. Every mutation persists to sessionStorage so
 * the in-progress sandbox survives the step-2 OAuth redirect; `reset` clears
 * both the in-memory state and the snapshot once the agent is created.
 */
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
