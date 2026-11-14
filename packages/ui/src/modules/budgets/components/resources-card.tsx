import type { BudgetVmUsage } from "api-server-api";

import type { AgentView } from "../../../types.js";
import { PoolUsage } from "./pool-usage.js";
import { RequestMoreLink } from "./request-more-link.js";

interface Props {
  usage: BudgetVmUsage;
  agents: readonly AgentView[];
}

export function ResourcesCard({ usage, agents }: Props) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm">
        <span className="text-foreground">Agents</span>
        <RequestMoreLink />
      </div>
      <PoolUsage usage={usage} agents={agents} />
    </div>
  );
}
