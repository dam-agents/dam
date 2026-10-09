import { Button } from "@/components/ui/button";

import { WorkingDots } from "../../sessions/components/working-dots.js";
import { useProcesses } from "../api/queries.js";
import { useOpenProcessesSection } from "../hooks/use-open-processes-section.js";
import { summarizeProcesses } from "../lib/process-summary.js";

const RESTART_PENDING_HINT = "A settings change is waiting";

export function ProcessesIndicator({ agentId }: { agentId: string | null }) {
  const { data } = useProcesses(agentId, { enabled: true, poll: false });
  const openSection = useOpenProcessesSection();
  if (!data) return null;
  const { running, keepingAwake, restartPending } = summarizeProcesses(data);
  if (running === 0) return null;

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
