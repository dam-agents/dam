import { Chemistry } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";

import { useFeatures } from "../../features/api/queries.js";
import { useExperiments } from "../api/queries.js";

/** Main-page visibility for a live run: a small chip on the driver agent's
 *  card. Purely informative — the row itself opens the chat, where the
 *  experiment panel docks. One shared list query backs every row. */
export function RunningExperimentChip({ agentId }: { agentId: string }) {
  const { data: features } = useFeatures();
  const { data: experiments } = useExperiments();

  if (!features?.experiments) return null;
  const running = experiments?.find(
    (e) => e.status === "running" && e.driverAgentId === agentId,
  );
  if (!running) return null;

  return (
    <Badge
      variant="secondary"
      title={`Experiment "${running.name}" is running`}
      className="gap-1 border-0 bg-blue-500/15 font-medium text-blue-600 dark:text-blue-400"
    >
      <Chemistry size={14} />
      experiment
    </Badge>
  );
}
