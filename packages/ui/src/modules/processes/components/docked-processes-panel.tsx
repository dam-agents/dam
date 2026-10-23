import { memo } from "react";

import { Spinner } from "@/components/ui/spinner";

import { useAgentReach } from "../../agents/api/queries.js";
import { SidePanelCloseButton } from "../../sessions/components/side-panel-close-button.js";
import { useProcesses } from "../api/queries.js";
import { ProcessList } from "./process-list.js";

interface Props {
  agentId: string;
}

export const DockedProcessesPanel = memo(function DockedProcessesPanel({
  agentId,
}: Props) {
  const reach = useAgentReach(agentId);
  const { data, isPending, isError } = useProcesses(agentId, {
    enabled: true,
    poll: true,
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="flex-1 text-sm font-medium text-foreground">
          Processes
        </span>
        <SidePanelCloseButton />
      </div>
      {reach === "inoperable" ? (
        <Notice text="Processes show once the agent is running." />
      ) : isError ? (
        <Notice text="Couldn't load the agent's processes." />
      ) : isPending || !data ? (
        <CenteredSpinner />
      ) : (
        <>
          {reach === "unreachable" && (
            <Notice text="Can't reach the agent right now. This list may be out of date." />
          )}
          <ProcessList agentId={agentId} list={data} alwaysOn={false} />
        </>
      )}
    </div>
  );
});

function CenteredSpinner() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner />
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <p className="px-4 py-5 text-sm text-muted-foreground">{text}</p>;
}
