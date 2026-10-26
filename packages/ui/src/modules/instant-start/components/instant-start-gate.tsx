import type { ReactNode } from "react";

import { CatchStyles } from "../../agents/components/catch-styles.js";
import {
  CatchCelebration,
} from "../../avatar-sheet/getting-started-checklist.js";
import { endCelebration, useCharacterUnlocks } from "../../agents/lib/character-unlocks.js";
import { useInstantStart } from "../context.js";
import { InstantStartDebugControls } from "./debug-controls.js";

function EggCrackOverlay() {
  const { celebrating } = useCharacterUnlocks();
  if (!celebrating) return null;
  return (
    <div className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center">
      <CatchStyles />
      <CatchCelebration
        key={celebrating.name}
        name={celebrating.name}
        variant="first"
        onFinished={endCelebration}
      />
    </div>
  );
}

export function InstantStartGate({ children }: { children: ReactNode }) {
  const ctx = useInstantStart();

  if (!ctx) return <>{children}</>;

  return (
    <>
      {children}
      {ctx.firstLanding && <EggCrackOverlay />}
      <InstantStartDebugControls />
    </>
  );
}
