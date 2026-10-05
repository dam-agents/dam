import { useAgentsList } from "../api/queries.js";
import { useUpdateSandbox } from "../hooks/use-update-sandbox.js";
import { UpdateAvailableAction } from "./update-available-action.js";

export function RuntimeOutdatedNotice({ agentId }: { agentId: string | null }) {
  const agents = useAgentsList();
  const { updateOne, updatingId, updatingAll } = useUpdateSandbox();
  const agent = agentId ? agents.find((a) => a.id === agentId) : undefined;
  const update = agent?.templateUpdate ?? null;
  if (!agent || !update) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-border/50 px-4 py-2 text-xs text-muted-foreground"
    >
      <span className="flex-1">
        This agent’s version is too old for live updates, so the session list
        and files can take a few seconds to update.
      </span>
      <UpdateAvailableAction
        agent={agent}
        onUpdate={() => void updateOne(agent)}
        pending={updatingId === agent.id}
        busy={updatingAll}
      />
    </div>
  );
}
