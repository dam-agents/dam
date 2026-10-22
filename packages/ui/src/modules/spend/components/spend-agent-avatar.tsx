import { useAgentsList } from "../../agents/api/queries.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";

export function SpendAgentAvatar({
  agentId,
  name,
}: {
  agentId: string;
  name: string;
}) {
  const agent = useAgentsList().find((a) => a.id === agentId);
  return (
    <AgentAvatar
      name={name}
      avatar={agent?.avatar}
      mood={agent ? "awake" : "disabled"}
      size={16}
    />
  );
}
