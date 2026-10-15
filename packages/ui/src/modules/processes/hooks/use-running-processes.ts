import { useAgentReach } from "../../agents/api/queries.js";
import { useProcesses } from "../api/queries.js";
import {
  type ProcessSummary,
  summarizeProcesses,
} from "../lib/process-summary.js";

// What the agent runs in the background, or null while there is nothing to
// show: no list yet, nothing running, or the agent not running at all (a
// cached list then is not running work).
export function useRunningProcesses(
  agentId: string | null,
): ProcessSummary | null {
  const { data } = useProcesses(agentId, { enabled: true, poll: false });
  const reach = useAgentReach(agentId);
  if (!data || reach === "inoperable") return null;
  const summary = summarizeProcesses(data);
  return summary.running > 0 ? summary : null;
}
