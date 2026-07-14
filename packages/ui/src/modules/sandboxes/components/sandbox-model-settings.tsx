import { Play } from "@carbon/icons-react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import {
  useAgentRunState,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { useWakeAgent } from "../../agents/hooks/use-wake-agent.js";
import { ModelSettingsPanel } from "../../sessions/components/model-settings-panel.js";

/**
 * Sandbox-home Model Settings: the shared panel in its page variant, gated by
 * the agent's lifecycle. Editable only while operable; asleep it shows the
 * last-known values (or placeholders) read-only with a "Start agent to edit"
 * action, and a spinner while the agent is coming up.
 */
export function SandboxModelSettings({ agentId }: { agentId: string }) {
  const runState = useAgentRunState(agentId);
  const operable = useIsAgentOperable(agentId);
  const restarting = useStore((s) => s.restartingAgents.has(agentId));
  const wakeAgent = useWakeAgent();

  // "Coming up" covers a real starting pod and the optimistic window right
  // after a wake/restart click, before the poll reports the transition.
  const comingUp =
    restarting || runState === "starting" || runState === "preparing_workspace";

  const headerAction = operable ? undefined : comingUp ? (
    <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
      <Loader2 size={12} className="animate-spin" />
      Starting…
    </span>
  ) : (
    <Button variant="outline" size="sm" onClick={() => wakeAgent.wake(agentId)}>
      <Play /> Start agent to edit
    </Button>
  );

  return (
    <ModelSettingsPanel
      agentId={agentId}
      variant="page"
      disabled={!operable}
      headerAction={headerAction}
    />
  );
}
