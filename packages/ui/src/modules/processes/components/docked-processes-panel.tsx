import { Close } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useAgentReach } from "../../agents/api/queries.js";
import { useProcesses } from "../api/queries.js";
import { summarizeProcesses } from "../lib/process-summary.js";
import { ProcessesSectionBody } from "./processes-panel.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Agent's processes docked beside the
 * conversation, as the design's chat refresh draws them: a header with the
 * title, a green dot while something runs and the close button, then the
 * same list the Processes section shows, polled while the panel is open.
 */
export function DockedProcessesPanel({ agentId }: { agentId: string }) {
  const setDock = useStore((s) => s.setDock);
  const reach = useAgentReach(agentId);
  const { data, isPending, isError } = useProcesses(agentId, {
    enabled: true,
    poll: true,
  });
  const running = data ? summarizeProcesses(data).running : 0;

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="docked-processes"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-medium text-foreground">
          Processes
          {running > 0 && (
            <span
              aria-hidden
              className="inline-block size-2 shrink-0 rounded-full bg-success"
            />
          )}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Close"
          tooltip="Close"
          onClick={() => setDock(null)}
        >
          <Close size={16} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ProcessesSectionBody
          agentId={agentId}
          reach={reach}
          data={data}
          isPending={isPending}
          isError={isError}
        />
      </div>
    </div>
  );
}
