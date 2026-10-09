import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import type { useAgentRows } from "./use-agent-rows.js";
import { useConfirmStopAgent } from "./use-confirm-stop-agent.js";

type AgentRows = ReturnType<typeof useAgentRows>;

export function useSandboxRowActions({
  deleteAgent,
  suspend,
}: Pick<AgentRows, "deleteAgent" | "suspend">) {
  const showConfirm = useStore((s) => s.showConfirm);
  const confirmStop = useConfirmStopAgent();

  const stopSandbox = async (agent: AgentView) => {
    if (!(await confirmStop(agent))) return;
    suspend.stop(agent.id);
  };

  const deleteSandbox = async (agent: AgentView) => {
    const msg = (
      <>
        Delete agent <strong className="text-foreground">"{agent.name}"</strong>
        ? This will also delete <strong>all persistent data</strong> and cannot
        be undone.
      </>
    );
    if (!(await showConfirm(msg, "Delete agent", { kind: "destructive" })))
      return;
    deleteAgent.mutate({ id: agent.id });
  };

  return { stopSandbox, deleteSandbox };
}
