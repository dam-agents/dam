import { emit, EventType } from "../../../events.js";
import { agentOwner, parseInfraAgent } from "./agent-mappers.js";
import type { KubeObject } from "./k8s.js";
import type { AgentObservation } from "./out-of-memory-watch.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Emits AgentResourceRemoved with the name an Agent
 * resource had when the watch saw it go. The watch sees every way an Agent
 * goes (a user delete, an Invocation reap, a Driver Cascade, a kubectl delete,
 * the orphan sweep), and a relist after a dropped watch reports a missed
 * delete too. Each replica runs its own watch, so the event comes once per
 * replica.
 */
export function agentRemovalWatch(
  kind: AgentObservation,
  obj: KubeObject,
): void {
  if (kind !== "delete") return;
  const agentId = obj.metadata?.name;
  const ownerSub = agentOwner(obj);
  if (!agentId || !ownerSub) return;
  emit({
    type: EventType.AgentResourceRemoved,
    agentId,
    ownerSub,
    name: parseInfraAgent(obj).name,
  });
}
