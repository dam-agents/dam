import { useStore } from "../../../store.js";
import { useAgentRunState, useIsAgentOperable } from "../api/queries.js";

export function useOperableState(agentId: string): {
  operable: boolean;
  comingUp: boolean;
} {
  const runState = useAgentRunState(agentId);
  const operable = useIsAgentOperable(agentId);
  const restarting = useStore((s) => s.restartingAgents.has(agentId));
  const comingUp =
    restarting || runState === "starting" || runState === "preparing_workspace";
  return { operable, comingUp };
}
