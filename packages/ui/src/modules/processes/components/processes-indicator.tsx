import { Button } from "@/components/ui/button";

import { WorkingDots } from "../../sessions/components/working-dots.js";
import { useOpenProcessesSection } from "../hooks/use-open-processes-section.js";
import { useRunningProcesses } from "../hooks/use-running-processes.js";

const RESTART_PENDING_HINT = "A settings change is waiting";

export function ProcessesIndicator({ agentId }: { agentId: string | null }) {
  const summary = useRunningProcesses(agentId);
  const openSection = useOpenProcessesSection();
  if (!summary) return null;
  const { running, keepingAwake, restartPending } = summary;

  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid="processes-indicator"
      className="text-muted-foreground"
      onClick={openSection}
    >
      <WorkingDots size="md" className="working-dots-slow text-success" />
      <span>
        {running} running
        {keepingAwake > 0 && ` · ${keepingAwake} keeping it awake`}
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
