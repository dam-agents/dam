import { useEffect, useRef } from "react";

import { emitToast } from "../../../lib/toast.js";
import { useAgentsList } from "../api/queries.js";

/**
 * Fires one toast per crash episode. `podTerminationReason` is abnormal-only
 * (OOM / non-zero exit) and absent on normal lifecycle, so a routine restart or
 * hibernation never toasts. Re-arms only once the agent genuinely recovers
 * (back to `running`/`hibernated`) — a crash-loop briefly flaps the reason on
 * each restart, and re-arming on that flap would re-toast every cycle.
 */
export function useAgentCrashToasts(): void {
  const agents = useAgentsList();
  const toastedRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const seen = toastedRef.current;
    const liveIds = new Set<string>();
    for (const agent of agents) {
      liveIds.add(agent.id);
      const reason = agent.podTerminationReason;
      if (reason && seen.get(agent.id) !== reason) {
        seen.set(agent.id, reason);
        emitToast({
          kind: "error",
          message: `${agent.name} crashed — ${reason}`,
        });
      } else if (agent.state === "running" || agent.state === "hibernated") {
        seen.delete(agent.id);
      }
    }
    for (const id of [...seen.keys()]) if (!liveIds.has(id)) seen.delete(id);
  }, [agents]);
}
