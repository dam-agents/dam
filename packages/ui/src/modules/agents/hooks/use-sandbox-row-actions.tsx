import type { AgentView } from "../../../types.js";
import type { useAgentRows } from "./use-agent-rows.js";
import { useConfirmDeleteAgent } from "./use-confirm-delete-agent.js";

type AgentRows = ReturnType<typeof useAgentRows>;

export function useSandboxRowActions({
  deleteAgent,
}: Pick<AgentRows, "deleteAgent">) {
  const confirmDelete = useConfirmDeleteAgent();

  const deleteSandbox = async (agent: AgentView) => {
    if (!(await confirmDelete(agent))) return;
    deleteAgent.mutate({ id: agent.id });
  };

  return { deleteSandbox };
}
