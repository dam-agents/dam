import { useAgentReach } from "../../agents/api/queries.js";
import { useProcesses } from "../api/queries.js";
import {
  type ProcessSummary,
  summarizeProcesses,
} from "../lib/process-summary.js";

export function useRunningProcesses(
  agentId: string | null,
): ProcessSummary | null {
  const { data } = useProcesses(agentId, { enabled: true, poll: false });
  const reach = useAgentReach(agentId);
  if (!data || reach === "inoperable") return null;
  const summary = summarizeProcesses(data);
  return summary.running > 0 ? summary : null;
}
