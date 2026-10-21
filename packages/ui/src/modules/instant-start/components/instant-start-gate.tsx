import type { ReactNode } from "react";

import { useInstantStart } from "../context.js";
import { InstantStartDebugControls } from "./debug-controls.js";
import { GettingStartedChecklist } from "./getting-started-checklist.js";

export function InstantStartGate({ children }: { children: ReactNode }) {
  const ctx = useInstantStart();

  if (!ctx) return <>{children}</>;

  return (
    <>
      {children}
      {ctx.firstLanding && <GettingStartedChecklist />}
      <InstantStartDebugControls />
    </>
  );
}
