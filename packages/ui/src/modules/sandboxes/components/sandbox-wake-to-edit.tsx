import { Play } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { useStore } from "../../../store.js";
import {
  useAgentRunState,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { useWakeAgent } from "../../agents/hooks/use-wake-agent.js";

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
      <span className="flex h-9 items-center gap-1.5 text-sm font-medium text-muted-foreground">
        Agent is starting…
        <Spinner />
      </span>
    );
  return (
    <Button variant="outline" size="sm" onClick={() => wakeAgent.wake(agentId)}>
      <Play /> Start agent to edit
    </Button>
  );
}
