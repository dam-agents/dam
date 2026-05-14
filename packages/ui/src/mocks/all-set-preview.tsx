/**
 * Dev-only preview of the SetupChecklist in its "all set" celebratory
 * state. Mounts the same component used in the real onboarding flow with
 * every step pre-marked complete so designers can iterate on the win
 * screen without doing a real provider+agent+connection setup. See
 * ./README.md.
 */
import { useEffect } from "react";

import { SetupChecklist } from "../modules/onboarding/welcome-tour.js";

export function AllSetPreview({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <SetupChecklist
      hasProvider
      hasAgent
      hasConnection
      allDone
      onDismiss={onClose}
    />
  );
}
