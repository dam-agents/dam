import { useState } from "react";

import { useNow } from "@/hooks/use-now";

import { useRootDriver } from "../../agents/hooks/use-root-driver.js";
import { AgentSpendLimitCard } from "../../spend/components/agent-spend-limit-card.js";
import { MeasuredUsage } from "../../spend/components/measured-usage.js";
import {
  DEFAULT_PERIOD,
  rangeOf,
  type SpendPeriod,
} from "../../spend/lib/spend-period.js";
import { utcDayOf } from "../../spend/lib/utc-day.js";
import { HarnessSpendCard } from "./harness-spend-card.js";

const MINUTE_MS = 60_000;

function localMonthOf(day: string): Date {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, 1);
}

export function SandboxUsageSection({ agentId }: { agentId: string }) {
  const root = useRootDriver(agentId);
  const [period, setPeriod] = useState<SpendPeriod>(DEFAULT_PERIOD);
  const today = utcDayOf(useNow(MINUTE_MS));

  return (
    <section className="mb-8">
      <AgentSpendLimitCard agentId={agentId} />
      {root === null && (
        <>
          <HarnessSpendCard
            agentId={agentId}
            month={localMonthOf(rangeOf(period, today).from)}
          />
          <MeasuredUsage
            agentId={agentId}
            period={period}
            onPeriodChange={setPeriod}
          />
        </>
      )}
    </section>
  );
}
