import type { AgentView } from "../../../types.js";
import { PoolUsage } from "./pool-usage.js";
import { RequestMoreLink } from "./request-more-link.js";

interface Props {
  agents: readonly AgentView[];
}

export function ResourcesCard({ agents }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm">
        <span className="text-foreground">VM agents</span>
        <RequestMoreLink />
      </div>
      <PoolUsage agents={agents} />
    </div>
  );
}
