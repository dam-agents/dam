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
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const names = joinNames(coverage.uncounted);
  const several = coverage.uncounted.length > 1;

  if (coverage.uncounted.length === 0) {
    return coverage.paid ? null : (
      <p className="text-sm text-muted-foreground">
        {hasLimit
          ? "This agent has no paid provider, so this limit never stops it."
          : "This agent has no paid provider, so it has no spend to limit."}
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      {coverage.paid
        ? `Calls on ${names} count only toward ${several ? "their own limits" : "its own limits"}, for this agent or for all agents, in `
        : `This agent uses only ${names}, so only a limit for this agent or for all agents in `}
      <Button
        variant="link"
        size="inline"
        onClick={() => navigateToSandboxHome(agentId, "providers")}
      >
        Providers
      </Button>
      {coverage.paid ? "." : " can stop it."}
    </p>
  );
}
