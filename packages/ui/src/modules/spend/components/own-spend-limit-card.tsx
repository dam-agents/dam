import type { SpendCeilingView, SpendStatus } from "api-server-api";

import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { TextSkeleton } from "@/components/ui/text-skeleton";
import { cn } from "@/lib/utils";

import { useOwnerSpendStatus } from "../api/queries.js";
import { formatSpend } from "../lib/format.js";
import { LIMIT_STATE_TEXT } from "../lib/state-colors.js";
import { SpendLimitField } from "./spend-limit-field.js";
import { SpendLimitMeter } from "./spend-limit-meter.js";

export function OwnSpendLimitCard() {
  const { data: status, isError } = useOwnerSpendStatus();

  return (
    <section className="mb-10">
      <SectionLabel spaced>Daily spend limit</SectionLabel>
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
        label="Limit for all your agents"
        scope={{ kind: "owner" }}
        unit="usd"
        amountMicros={own?.amountMicros ?? null}
      />
      {own ? (
        <SpendLimitMeter
          label="Limit for all your agents"
          unit="usd"
          spentMicros={own.spentMicros}
          limitMicros={own.effectiveMicros}
          state={own.state}
          extensions={own.extensions}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {formatSpend(usd?.costMicros ?? 0, "usd")} metered today
        </p>
      )}
      {status.ceiling && <CeilingLine ceiling={status.ceiling} />}
    </>
  );
}

function CeilingLine({ ceiling }: { ceiling: SpendCeilingView }) {
  return (
    <p
      className={cn(
        "text-sm",
        ceiling.state === "ok"
          ? "text-muted-foreground"
          : LIMIT_STATE_TEXT[ceiling.state],
      )}
    >
      Spend ceiling from the platform operator:{" "}
      {formatSpend(ceiling.spentMicros, "usd")} of{" "}
      {formatSpend(ceiling.amountMicros, "usd")} today
      {ceiling.state === "reached" ? ", reached" : ""}.
    </p>
  );
}
