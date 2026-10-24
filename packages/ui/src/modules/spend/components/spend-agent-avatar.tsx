import { useAgent } from "../../agents/api/queries.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";

export function SpendAgentAvatar({
  agentId,
  name,
}: {
  agentId: string;
  name: string;
}) {
  const agent = useAgent(agentId);
  return (
    <AgentAvatar
      name={name}
      avatar={agent?.avatar}
      mood={agent ? "awake" : "disabled"}
      size={16}
    />
  );
}
