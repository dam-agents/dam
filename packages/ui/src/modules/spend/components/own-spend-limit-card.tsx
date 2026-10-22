import type { SpendStatus } from "api-server-api";

import { useOwnerSpendStatus } from "../api/queries.js";
import { ALL_YOUR_AGENTS, OWN_LIMIT_HELP } from "../lib/copy.js";
import { totalLevels } from "../lib/limit-levels.js";
import { unitTotals } from "../lib/measured-spend.js";
import { AlsoCountedBy } from "./also-counted-by.js";
import { DailyLimitCard, DailyLimitCardPending } from "./daily-limit-card.js";
import { DailyLimitMeter } from "./daily-limit-meter.js";
import { ProviderLimitsSummary } from "./provider-limits-summary.js";
import { SpendLimitButton } from "./spend-limit-button.js";

export function OwnSpendLimitCard() {
  const { data: status, isError } = useOwnerSpendStatus();
  if (!status) {
    return <DailyLimitCardPending help={OWN_LIMIT_HELP} failed={isError} />;
  }
  return <OwnSpendLimitBody status={status} />;
}

function OwnSpendLimitBody({ status }: { status: SpendStatus }) {
  const own = status.limits.find((view) => view.scope.kind === "owner");

  return (
    <DailyLimitCard
      help={OWN_LIMIT_HELP}
      resetsAt={status.resetsAt}
      action={
        <SpendLimitButton
          scope={{ kind: "owner" }}
          subject={ALL_YOUR_AGENTS}
          amountMicros={own?.amountMicros ?? null}
        />
      }
    >
      <DailyLimitMeter
        spentMicros={unitTotals(status.spent).usd}
        limit={own}
        resetsAt={status.resetsAt}
        subject={ALL_YOUR_AGENTS}
      />
      <AlsoCountedBy
        levels={totalLevels(status).others}
        agentId={null}
        agent={null}
      />
      <ProviderLimitsSummary limits={status.limits} />
    </DailyLimitCard>
  );
}
