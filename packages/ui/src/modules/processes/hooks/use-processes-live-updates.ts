import { useProcesses } from "../api/queries.js";
import { useProcessesWatch } from "./use-processes-watch.js";

export function useProcessesLiveUpdates(
  agentId: string | null,
  enabled: boolean,
) {
  const { data } = useProcesses(agentId, { enabled, poll: false });
  useProcessesWatch(agentId, enabled && data !== undefined);
}
