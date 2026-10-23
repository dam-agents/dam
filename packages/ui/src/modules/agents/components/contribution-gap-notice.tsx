import { useAgentUpdateAction } from "../hooks/use-update-sandbox.js";
import { contributionKindList } from "../lib/contribution-kind-labels.js";
import { AgentOutdatedNotice } from "./agent-outdated-notice.js";

export function ContributionGapNotice({ agentId }: { agentId: string | null }) {
  const { agent, updateOne, pending } = useAgentUpdateAction(agentId);
  const kinds = agent?.unsupportedContributionKinds ?? [];
  if (!agent || kinds.length === 0) return null;

  return (
    <AgentOutdatedNotice
      agent={agent}
      onUpdate={() => void updateOne(agent)}
      pending={pending}
    >
      This agent&rsquo;s runtime is too old to accept{" "}
      {contributionKindList(kinds)} it was granted, so it is running without
      them.
      {agent.templateUpdate
        ? " Updating the agent applies them."
        : " No runtime update is available yet."}
    </AgentOutdatedNotice>
  );
}
