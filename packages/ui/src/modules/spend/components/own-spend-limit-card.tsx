import type { SpendCeilingView, SpendStatus } from "api-server-api";

import { cn } from "@/lib/utils";

import { useOwnerSpendStatus } from "../api/queries.js";
import {
  ALL_YOUR_AGENTS,
  CEILING_HELP,
  ceilingLine,
  OWN_LIMIT_HELP,
  paidCallsStop,
} from "../lib/copy.js";
import { localResetTime } from "../lib/format.js";
import { unitTotals } from "../lib/measured-spend.js";
import { LIMIT_STATE_TEXT } from "../lib/state-colors.js";
import { DailyLimitCard, DailyLimitCardPending } from "./daily-limit-card.js";
import { DailyLimitMeter } from "./daily-limit-meter.js";
import { HelpTip } from "./help-tip.js";
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
      {status.ceiling && (
        <CeilingLine ceiling={status.ceiling} resetsAt={status.resetsAt} />
      )}
      <ProviderLimitsSummary limits={status.limits} />
    </DailyLimitCard>
  );
}

function CeilingLine({
  ceiling,
  resetsAt,
}: {
  ceiling: SpendCeilingView;
  resetsAt: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <p
        className={cn(
          "flex items-center gap-1.5 tabular-nums",
          ceiling.state === "ok"
            ? "text-muted-foreground"
            : LIMIT_STATE_TEXT[ceiling.state],
        )}
      >
        {ceilingLine(ceiling.spentMicros, ceiling.amountMicros)}
        <HelpTip content={CEILING_HELP} />
      </p>
      {ceiling.state === "reached" && (
        <p className={LIMIT_STATE_TEXT.reached}>
          {paidCallsStop(localResetTime(resetsAt))}
        </p>
      )}
    </div>
  );
}
