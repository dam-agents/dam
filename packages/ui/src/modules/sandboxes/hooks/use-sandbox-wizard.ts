import { useCallback, useState } from "react";

import {
  clearSnapshot,
  EMPTY_SNAPSHOT,
  KINDED_HARNESS_TEMPLATE_ID,
  loadSnapshot,
  saveSnapshot,
  startingPointSchema,
  type WizardSnapshot,
} from "../lib/wizard-snapshot.js";

export interface SandboxWizard {
  snapshot: WizardSnapshot;
  update: (patch: Partial<WizardSnapshot>) => void;
  reset: () => void;
}

function initialSnapshot(): WizardSnapshot {
  const saved = loadSnapshot();
  if (saved.startingPoint) return saved;
  const params = new URLSearchParams(window.location.search);
  const sp = params.get("startingPoint");
  if (sp && startingPointSchema.safeParse(sp).success) {
    const startingPoint = sp as WizardSnapshot["startingPoint"];
    const seeded: WizardSnapshot = {
      ...EMPTY_SNAPSHOT,
      startingPoint,
      templateId:
        startingPoint === "experiment" || startingPoint === "knowledge-base"
          ? KINDED_HARNESS_TEMPLATE_ID
          : null,
    };
    saveSnapshot(seeded);
    return seeded;
  }
  return saved;
}

export function useSandboxWizard(): SandboxWizard {
  const [snapshot, setSnapshot] = useState<WizardSnapshot>(initialSnapshot);

  const update = useCallback((patch: Partial<WizardSnapshot>) => {
    setSnapshot((prev) => {
      const next = { ...prev, ...patch };
      if (patch.step !== undefined) {
        next.maxStep = Math.max(
          prev.maxStep || prev.step,
          patch.step,
        ) as WizardSnapshot["step"];
      }
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
