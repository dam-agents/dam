import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { useStore } from "../../../store.js";
import { useCreateAgent } from "../../agents/api/mutations.js";
import { useInstantStart } from "../context.js";
import { InstantStartDebugControls } from "./debug-controls.js";
import { GettingStartedChecklist } from "./getting-started-checklist.js";

export function InstantStartGate({ children }: { children: ReactNode }) {
  const ctx = useInstantStart();

  if (!ctx) return <>{children}</>;

  return (
    <>
      <AutoCreateAgent />
      {children}
      {ctx.firstLanding && <GettingStartedChecklist />}
      <InstantStartDebugControls />
    </>
  );
}

function AutoCreateAgent() {
  const createAgent = useCreateAgent();
  const createdRef = useRef(false);
  const selectAgent = useStore((s) => s.selectAgent);

  useEffect(() => {
    if (createdRef.current) return;
    createdRef.current = true;
    createAgent
      .mutateAsync({
        name: "agent",
        templateId: "claude-code",
        egressPreset: "trusted",
      })
      .then((agent) => {
        selectAgent(agent.id);
      })
      .catch(() => {});
  }, []);

  return null;
}
