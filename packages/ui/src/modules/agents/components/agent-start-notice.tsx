import { Renew, Warning } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import type { AgentView } from "../../../types.js";
import { useRestartAgent } from "../hooks/use-restart-agent.js";
import type { AgentDisplay } from "../utils/agent-resolver.js";

export function hasStartNotice(
  agent: Pick<AgentView, "podTerminationReason">,
  display: Pick<AgentDisplay, "slowStart" | "powerAction">,
): boolean {
  return (
    display.slowStart ||
    !!agent.podTerminationReason ||
    display.powerAction === "restart"
  );
}

export function AgentStartNotice({
  agent,
  display,
}: {
  agent: Pick<AgentView, "id" | "podTerminationReason" | "notReadyMessage">;
  display: AgentDisplay;
}) {
  const { restart, isPending: restarting } = useRestartAgent();
  const slow = display.slowStart && !agent.podTerminationReason;

  return (
    <div
      className="flex flex-col items-start gap-1.5 text-xs"
      data-testid="agent-start-notice"
    >
      {slow && (
        <p role="status" className="flex items-center gap-1.5 text-warning">
          <Warning size={12} className="shrink-0" />
          Starting is taking longer than usual.
        </p>
      )}
      {slow && agent.notReadyMessage && (
        <pre className="max-h-24 max-w-full overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-2xs text-muted-foreground">
          {agent.notReadyMessage}
        </pre>
      )}
      {agent.podTerminationReason && (
        <p className="flex items-center gap-1.5 font-mono text-danger">
          <Warning size={12} className="shrink-0" />
          {agent.podTerminationReason}
        </p>
      )}
      {display.powerAction === "restart" && (
        <Button
          variant="outline"
          size="xs"
          onClick={() => restart(agent.id)}
          disabled={restarting}
        >
          <Renew size={12} /> Restart agent
        </Button>
      )}
    </div>
  );
}
