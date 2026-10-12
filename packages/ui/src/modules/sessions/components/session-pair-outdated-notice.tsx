import { useAgentsList } from "../../agents/api/queries.js";
import { UpdateAvailableAction } from "../../agents/components/update-available-action.js";
import { useUpdateSandbox } from "../../agents/hooks/use-update-sandbox.js";

export function SessionPairOutdatedNotice({ agentId }: { agentId: string }) {
  const agents = useAgentsList();
  const { updateOne, updatingId, updatingAll } = useUpdateSandbox();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 pl-3 text-sm text-muted-foreground"
    >
      <span className="flex-1">
        This agent&rsquo;s version is too old to choose a harness and model per
        session, so sessions use the agent&rsquo;s defaults.
        {agent.templateUpdate
          ? " Update the agent to choose them."
          : " No update is available yet."}
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
