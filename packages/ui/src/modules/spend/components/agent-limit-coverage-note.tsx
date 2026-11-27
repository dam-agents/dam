import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { type AgentLimitCoverage, joinNames } from "../lib/coverage.js";

export function AgentLimitCoverageNote({
  agentId,
  coverage,
  hasLimit,
}: {
  agentId: string;
  coverage: AgentLimitCoverage;
  hasLimit: boolean;
}) {
  const openAgentSettings = useStore((s) => s.openAgentSettings);
  const names = joinNames(coverage.uncounted);
  const several = coverage.uncounted.length > 1;

  if (coverage.uncounted.length === 0) {
    return coverage.paid ? null : (
      <p className="text-sm text-muted-foreground">
        {hasLimit
          ? "This agent has no paid provider yet, so this limit counts nothing until it gets one."
          : "This limit counts the agent's paid calls. It has no paid provider yet."}
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      {coverage.paid
        ? `Calls on ${names} count only toward ${several ? "their own limits" : "its own limits"}, for this agent or for all agents, in `
        : `This limit counts paid calls, and this agent uses only ${names}. Limit ${names} for this agent or for all agents in `}
      <Button
        variant="link"
        size="inline"
        onClick={() => openAgentSettings(agentId, "providers")}
      >
        Providers
      </Button>
      .
    </p>
  );
}
