import { Play } from "@carbon/icons-react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import {
  useAgentRunState,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { useWakeAgent } from "../../agents/hooks/use-wake-agent.js";

/**
 * Lifecycle gate for settings that need a running pod. `comingUp` also covers
 * the optimistic window right after a wake/restart click, before the poll
 * reports the transition.
 */
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

/** Header affordance for a read-only section: a spinner while the agent is
 *  coming up, otherwise a "Start agent to edit" wake button. Render only when
 *  the agent isn't operable. */
export function WakeToEditButton({
  agentId,
  comingUp,
}: {
  agentId: string;
  comingUp: boolean;
}) {
  const wakeAgent = useWakeAgent();
  if (comingUp)
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        Starting…
      </span>
    );
  return (
    <Button variant="outline" size="sm" onClick={() => wakeAgent.wake(agentId)}>
      <Play /> Start agent to edit
    </Button>
  );
}
