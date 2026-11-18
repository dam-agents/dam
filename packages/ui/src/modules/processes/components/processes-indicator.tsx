import { Button } from "@/components/ui/button";

import { WorkingDots } from "../../sessions/components/working-dots.js";
import { useRunningProcesses } from "../hooks/use-running-processes.js";

const RESTART_PENDING_HINT = "A settings change is waiting";

/** UNIT_BOUNDARY_DESCRIPTION: the Agent's running count beside the agent menu, as the design draws it; a click shows its processes beside the conversation, through the same toggle as the menu's Processes. */
export function ProcessesIndicator({
  agentId,
  onOpen,
}: {
  agentId: string | null;
  onOpen: () => void;
}) {
  const summary = useRunningProcesses(agentId);
  if (!summary) return null;
  const { running, keepingAwake, restartPending } = summary;

  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid="processes-indicator"
      className="text-muted-foreground"
      onClick={onOpen}
    >
      <WorkingDots size="md" className="working-dots-slow text-accent" />
      <span>
        {running} running
        {keepingAwake > 0 && (
          <>
            {" · "}
            <span className="text-warning-fg">
              {keepingAwake} keeping it awake
            </span>
          </>
        )}
      </span>
      {restartPending && (
        <span
          role="img"
          aria-label={RESTART_PENDING_HINT}
          title={RESTART_PENDING_HINT}
          className="size-1.5 rounded-full bg-warning"
        />
      )}
    </Button>
  );
}
