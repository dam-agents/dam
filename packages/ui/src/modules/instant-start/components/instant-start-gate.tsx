import type { ReactNode } from "react";

import { useInstantStart } from "../context.js";
import { InstantStartDebugControls } from "./debug-controls.js";

export function InstantStartGate({ children }: { children: ReactNode }) {
  const ctx = useInstantStart();

  if (!ctx) return <>{children}</>;

  return (
    <>
      {children}
      <InstantStartDebugControls />
    </>
  );
}
