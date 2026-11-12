import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

import { useStore } from "../../../store.js";
import { useAgent } from "../api/queries.js";
import { nextOpenWake, NO_OPEN_WAKE } from "../lib/auto-wake.js";
import { useWakeAgent } from "./use-wake-agent.js";

function onVisibilityChange(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

// UNIT_BOUNDARY_DESCRIPTION: the wake runs in a layout effect, so the agent already shows as starting in the first painted frame and no sleeping frame flashes. A hidden page wakes nothing; it decides once it is shown again.
export function useAutoWakeOnOpen(agentId: string | null): void {
  const agent = useAgent(agentId);
  const { wake } = useWakeAgent();
  const memo = useRef(NO_OPEN_WAKE);
  const visible = useSyncExternalStore(
    onVisibilityChange,
    () => document.visibilityState === "visible",
    () => true,
  );

  useLayoutEffect(() => {
    if (!visible) return;
    const next = nextOpenWake(
      memo.current,
      agentId,
      agent ?? undefined,
      !!agentId && useStore.getState().restartingAgents.has(agentId),
    );
    memo.current = next.memo;
    if (next.wake && agentId) wake(agentId);
  }, [agentId, agent, wake, visible]);
}
