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
  label = "Start agent to edit",
}: {
  agentId: string;
  comingUp: boolean;
  /** Wake-button label. Defaults to "Start agent to edit"; sections where only
   *  some actions need the pod pass a more precise label. */
  label?: string;
}) {
  const wakeAgent = useWakeAgent();
  if (comingUp)
    return (
      // Matches the weight/size of the wake button it replaces (text-sm
      // font-medium), so the slot reads consistently.
      <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        Agent is starting…
        <Loader2 size={14} className="animate-spin" />
      </span>
    );
  return (
    <Button variant="outline" size="sm" onClick={() => wakeAgent.wake(agentId)}>
      <Play /> {label}
    </Button>
  );
}
