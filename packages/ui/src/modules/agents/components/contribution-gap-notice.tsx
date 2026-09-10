import { useAgentsList } from "../api/queries.js";
import { useUpdateSandbox } from "../hooks/use-update-sandbox.js";
import { contributionKindList } from "../lib/contribution-kind-labels.js";
import { UpdateAvailableAction } from "./update-available-action.js";

export function ContributionGapNotice({ agentId }: { agentId: string | null }) {
  const agents = useAgentsList();
  const { updateOne, updatingId, updatingAll } = useUpdateSandbox();
  const agent = agentId ? agents.find((a) => a.id === agentId) : undefined;
  const kinds = agent?.unsupportedContributionKinds ?? [];
  if (!agent || kinds.length === 0) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-border/50 px-4 py-2 text-xs text-muted-foreground"
    >
      <span className="flex-1">
        This agent&rsquo;s runtime is too old to accept{" "}
        {contributionKindList(kinds)} it was granted, so it is running without
        them.
        {agent.templateUpdate
          ? " Updating the agent applies them."
          : " No runtime update is available yet."}
      </span>
      {agent.templateUpdate && (
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
