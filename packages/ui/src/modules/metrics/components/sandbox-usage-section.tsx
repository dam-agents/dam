import { useState } from "react";

import { useRootDriver } from "../../agents/hooks/use-root-driver.js";
import { AgentSpendLimitCard } from "../../spend/components/agent-spend-limit-card.js";
import { MeasuredUsage } from "../../spend/components/measured-usage.js";
import { subAgentOwnCalls } from "../../spend/lib/copy.js";
import {
  DEFAULT_PERIOD,
  type SpendPeriod,
} from "../../spend/lib/spend-period.js";

export function SandboxUsageSection({ agentId }: { agentId: string }) {
  const root = useRootDriver(agentId);
  const [period, setPeriod] = useState<SpendPeriod>(DEFAULT_PERIOD);

  return (
    <section className="mb-8">
      <AgentSpendLimitCard agentId={agentId} />
      {root && (
        <p className="mb-4 text-sm text-muted-foreground">
          {subAgentOwnCalls(root.name)}
        </p>
      )}
      <MeasuredUsage
        agentId={agentId}
        period={period}
        onPeriodChange={setPeriod}
      />
    </section>
  );
}
