import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import {
  type AgentLimitCoverage,
  capitalize,
  joinNames,
} from "../lib/coverage.js";

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
  const providersLink = (
    <Button
      variant="link"
      size="inline"
      onClick={() => navigateToSandboxHome(agentId, "providers")}
    >
      Providers
    </Button>
  );
  const names = joinNames(coverage.uncounted);
  const several = coverage.uncounted.length > 1;

  if (coverage.uncounted.length === 0) {
    return coverage.paid ? null : (
      <p className="text-sm text-muted-foreground">
        This agent has no paid provider, so it has no spend to limit
        {hasLimit ? ", and this limit never stops it." : "."}
      </p>
    );
  }
  const connections = `${several ? "limits" : "a limit"} on ${names}`;
  return (
    <p className="text-sm text-muted-foreground">
      {coverage.paid
        ? `Calls on ${names} do not count here. Set ${several ? "their limits" : "its limit"} in `
        : hasLimit
          ? `${capitalize(`this agent uses only ${names}, so this limit never stops it. Remove it, and set ${connections} in `)}`
          : `${capitalize(`this agent uses only ${names}, which the agent spend limit does not count. Set ${connections} in `)}`}
      {providersLink}.
    </p>
  );
}
