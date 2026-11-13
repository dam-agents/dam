import { Close } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { processList } from "../../../mock/data/processes.js";
import { useStore } from "../../../store.js";
import { summarizeProcesses } from "../lib/process-summary.js";
import { ProcessList } from "./process-list.js";

export function DockedProcessesPanel({ agentId }: { agentId: string | null }) {
  const close = useStore((s) => s.setOpenProcessesPanelDocked);
  const { running } = summarizeProcesses(processList);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-medium text-foreground">
          Processes
          {running > 0 && (
            <span className="inline-block size-2 shrink-0 rounded-full bg-[#24a148] dark:bg-[#42be65]" />
          )}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Close"
          tooltip="Close"
          onClick={() => close(false)}
        >
          <Close size={16} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {agentId ? (
          <ProcessList agentId={agentId} list={processList} alwaysOn={false} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="text-sm text-muted-foreground">
              Processes show once the agent is running.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
