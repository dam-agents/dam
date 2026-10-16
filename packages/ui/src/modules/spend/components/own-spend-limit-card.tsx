import type { SpendCeilingView, SpendStatus } from "api-server-api";

import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { TextSkeleton } from "@/components/ui/text-skeleton";
import { cn } from "@/lib/utils";

import { useOwnerSpendStatus } from "../api/queries.js";
import { CEILING_NAME, OWN_LIMIT_NAME } from "../lib/copy.js";
import { formatSpend, formatSpendOf, localResetTime } from "../lib/format.js";
import { LIMIT_STATE_TEXT } from "../lib/state-colors.js";
import { SpendLimitField } from "./spend-limit-field.js";
import { SpendLimitMeter } from "./spend-limit-meter.js";

export function OwnSpendLimitCard() {
  const { data: status, isError } = useOwnerSpendStatus();

  return (
    <section className="mb-10">
      <SectionLabel spaced>Spend limits</SectionLabel>
      <Card className="flex flex-col gap-3 p-5">
        {isError ? (
          <p className="text-sm text-muted-foreground">
            Couldn't load today's spend.
          </p>
        ) : status ? (
          <OwnSpendLimitBody status={status} />
        ) : (
          <TextSkeleton width={160} />
        )}
      </Card>
    </section>
  );
}

function OwnSpendLimitBody({ status }: { status: SpendStatus }) {
  const own = status.limits.find((view) => view.scope.kind === "owner");
  const usd = status.spent.find((total) => total.unit === "usd");

  return (
    <>
      <SpendLimitField
        label={OWN_LIMIT_NAME}
        scope={{ kind: "owner" }}
        unit="usd"
        amountMicros={own?.amountMicros ?? null}
      />
      {own ? (
        <SpendLimitMeter
          label={OWN_LIMIT_NAME}
          unit="usd"
          spentMicros={own.spentMicros}
          limitMicros={own.effectiveMicros}
          state={own.state}
          extensions={own.extensions}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {formatSpend(usd?.costMicros ?? 0, "usd")} paid API spend today, all
          your agents
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Counts the paid API spend of all your agents. The Claude subscription
        and Bob do not count here: set their limits in each agent's Providers
        section. Limits reset at {localResetTime(status.resetsAt)} your time.
      </p>
      {status.ceiling && (
        <CeilingLine ceiling={status.ceiling} resetsAt={status.resetsAt} />
      )}
    </>
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
    <p
      className={cn(
        "border-t border-border pt-3 text-sm",
        ceiling.state === "ok"
          ? "text-muted-foreground"
          : LIMIT_STATE_TEXT[ceiling.state],
      )}
    >
      {CEILING_NAME}:{" "}
      {formatSpendOf(ceiling.spentMicros, ceiling.amountMicros, "usd")} today.
      {ceiling.state === "reached" &&
        ` Paid model calls stop until ${localResetTime(resetsAt)} your time.`}
    </p>
  );
}
