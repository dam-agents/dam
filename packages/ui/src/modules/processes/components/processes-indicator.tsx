import { Button } from "@/components/ui/button";

import { processList } from "../../../mock/data/processes.js";
import { useStore } from "../../../store.js";
import { WorkingDots } from "../../sessions/components/working-dots.js";
import { summarizeProcesses } from "../lib/process-summary.js";

const RESTART_PENDING_HINT = "A settings change is waiting";

export function ProcessesIndicator({
  onClick,
}: {
  agentId: string | null;
  onClick?: () => void;
}) {
  const openPanel = useStore((s) => s.setOpenProcessesPanelDocked);
  const { running, keepingAwake, restartPending } =
    summarizeProcesses(processList);
  if (running === 0) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid="processes-indicator"
      className="text-muted-foreground"
      onClick={onClick ?? (() => openPanel(true))}
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
