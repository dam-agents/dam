import { useAgentsList } from "../api/queries.js";
import { useUpdateSandbox } from "../hooks/use-update-sandbox.js";
import { UpdateAvailableAction } from "./update-available-action.js";

export function RuntimeOutdatedNotice({ agentId }: { agentId: string | null }) {
  const agents = useAgentsList();
  const { updateOne, updatingId, updatingAll } = useUpdateSandbox();
  const agent = agentId ? agents.find((a) => a.id === agentId) : undefined;
  const update = agent?.templateUpdate ?? null;

  return (
    <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2 text-xs text-muted-foreground">
      <span className="flex-1">
        Live updates need a newer agent runtime — showing polled data.
        {update ? "" : " Update this agent to get instant updates."}
      </span>
      {agent && update && (
        <UpdateAvailableAction
          agent={agent}
          onUpdate={() => void updateOne(agent)}
          pending={updatingId === agent.id}
          busy={updatingAll}
        />
      )}
    </div>
  );
}
