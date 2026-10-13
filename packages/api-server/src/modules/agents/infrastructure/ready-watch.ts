import { readyConditionStatus } from "./agent-mappers.js";
import type { KubeObject } from "./k8s.js";
import type { AgentObservation } from "./out-of-memory-watch.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Calls back once each time an Agent's Ready
 * condition turns True. Ready also needs the gateway pod, so a grant that rolls
 * the gateway takes Ready down while the agent pod keeps running and sends no
 * hello; the state dispatch that raced the roll then waits for the next
 * minute's outbox sweep. The callback lets that state go out the moment Ready
 * is back. An Agent first seen on "add" (informer start or relist) is only the
 * baseline, so a restarted api-server does not re-deliver to every agent.
 */
export function createReadyWatch(
  onReady: (agentId: string) => void,
): (kind: AgentObservation, obj: KubeObject) => void {
  const ready = new Map<string, boolean>();
  return (kind, obj) => {
    const id = obj.metadata?.name;
    if (!id) return;
    if (kind === "delete") {
      ready.delete(id);
      return;
    }
    const now = readyConditionStatus(obj) === "True";
    const before = ready.get(id);
    ready.set(id, now);
    if (kind === "update" && now && before === false) onReady(id);
  };
}
