import type { AgentView } from "../../../types.js";
import type { useAgentRows } from "./use-agent-rows.js";
import { useConfirmDeleteAgent } from "./use-confirm-delete-agent.js";
import { useConfirmStopAgent } from "./use-confirm-stop-agent.js";

type AgentRows = ReturnType<typeof useAgentRows>;

export function useSandboxRowActions({
  deleteAgent,
  suspend,
}: Pick<AgentRows, "deleteAgent" | "suspend">) {
  const confirmDelete = useConfirmDeleteAgent();
  const confirmStop = useConfirmStopAgent();

  const stopSandbox = async (agent: AgentView) => {
    if (!(await confirmStop(agent))) return;
    suspend.stop(agent.id);
  };

  const deleteSandbox = async (agent: AgentView) => {
    if (!(await confirmDelete(agent))) return;
    deleteAgent.mutate({ id: agent.id });
  };

  return { stopSandbox, deleteSandbox };
}
