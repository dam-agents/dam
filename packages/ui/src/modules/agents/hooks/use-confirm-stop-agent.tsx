import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { fetchSchedulesForAgent } from "../../schedules/api/queries.js";
import { isUpcoming } from "../../schedules/lib/once-schedule.js";

export function useConfirmStopAgent() {
  const showConfirm = useStore((s) => s.showConfirm);

  return async (agent: AgentView): Promise<boolean> => {
    const schedules = (await fetchSchedulesForAgent(agent.id)).filter(
      isUpcoming,
    );
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
    return showConfirm(msg, "Stop Agent");
  };
}
