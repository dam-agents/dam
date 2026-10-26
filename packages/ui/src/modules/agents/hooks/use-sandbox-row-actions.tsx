import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { fetchSchedulesForAgent } from "../../schedules/api/queries.js";
import type { useAgentRows } from "./use-agent-rows.js";

type AgentRows = ReturnType<typeof useAgentRows>;

export function useSandboxRowActions({
  deleteAgent,
  suspend,
}: Pick<AgentRows, "deleteAgent" | "suspend">) {
  const showConfirm = useStore((s) => s.showConfirm);

  const stopSandbox = async (agent: AgentView) => {
    const schedules = await fetchSchedulesForAgent(agent.id);
    const scheduleNote =
      schedules.length > 0 ? (
        <>
          {" "}
          This agent has <strong>{schedules.length} schedule(s)</strong> — the
          next fire will start it again.
        </>
      ) : null;
    const msg = (
      <>
        Stop agent <strong className="text-foreground">"{agent.name}"</strong>?
        It stays stopped until you start it.{scheduleNote}
      </>
    );
    if (!(await showConfirm(msg, "Stop Agent"))) return;
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
    if (!(await showConfirm(msg, "Delete Agent", { kind: "destructive" })))
      return;
    deleteAgent.mutate({ id: agent.id });
  };

  return { stopSandbox, deleteSandbox };
}
