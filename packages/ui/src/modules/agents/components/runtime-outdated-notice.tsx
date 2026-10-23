import { useAgentUpdateAction } from "../hooks/use-update-sandbox.js";
import { AgentOutdatedNotice } from "./agent-outdated-notice.js";

export function RuntimeOutdatedNotice({ agentId }: { agentId: string | null }) {
  const { agent, update, updateOne, pending } = useAgentUpdateAction(agentId);
  if (!agent || !update) return null;

  return (
    <AgentOutdatedNotice
      agent={agent}
      onUpdate={() => void updateOne(agent)}
      pending={pending}
    >
      This agent’s version is too old for live updates, so the session list and
      files can take a few seconds to update.
    </AgentOutdatedNotice>
  );
}
