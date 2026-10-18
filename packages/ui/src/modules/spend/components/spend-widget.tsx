import type { SpendBreakdown } from "api-server-api";
import { MotionConfig } from "motion/react";
import { useState } from "react";

import { Spinner } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/tabs";
import { TextSkeleton } from "@/components/ui/text-skeleton";
import { useNow } from "@/hooks/use-now";

import {
  useOwnerSpendStatus,
  useSpendBreakdown,
  useSpendMetering,
} from "../api/queries.js";
import { useShowPlanUse } from "../hooks/use-spend-preferences.js";
import {
  API_SPEND_TITLE,
  apiSpendHelp,
  OWN_LIMIT_NAME,
  PERIOD_LABELS,
  SPEND_LOAD_ERROR,
} from "../lib/copy.js";
import { microsToUsd } from "../lib/format.js";
import { unitTotals } from "../lib/measured-spend.js";
import { measuredRange } from "../lib/range-label.js";
import {
  DEFAULT_PERIOD,
  HOME_PERIODS,
  type PresetPeriod,
  rangeOf,
} from "../lib/spend-period.js";
import { utcDayOf } from "../lib/utc-day.js";
import { AnimatedUsd } from "./animated-usd.js";
import { HelpTip } from "./help-tip.js";
import { MeteringNotice } from "./metering-notice.js";
import { PlanUseCheckbox } from "./plan-use-checkbox.js";
import { SpendLimitMeter } from "./spend-limit-meter.js";
import { SpendRangeLine, SpendSideLines } from "./spend-total-lines.js";
import { TopSpenders, TopSpendersSkeleton } from "./top-spenders.js";
import { ViewDetailsLink } from "./view-details-link.js";

const REFRESH_MS = 30_000;

const PERIOD_TABS = HOME_PERIODS.map((value) => ({
  value,
  label: PERIOD_LABELS[value],
}));

export function SpendWidget() {
  const [period, setPeriod] = useState<PresetPeriod>(DEFAULT_PERIOD);
  const today = utcDayOf(useNow(REFRESH_MS));
  const range = rangeOf(period, today);
  const { data: metering } = useSpendMetering();
  const query = useSpendBreakdown(range);
  const showPlanUse = useShowPlanUse();
  const { data: status } = useOwnerSpendStatus();
  const ownLimit = status?.limits.find((view) => view.scope.kind === "owner");
  const data = query.data;
  const totals = unitTotals(data?.totals ?? []);
  const measured = metering
    ? measuredRange(range, metering.startDay) !== null
    : true;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col rounded-lg border border-border bg-card p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="flex items-center gap-1.5 whitespace-nowrap text-sm text-foreground">
            {API_SPEND_TITLE}
            <HelpTip content={apiSpendHelp()} />
            {query.isFetching && (
              <Spinner
                size={12}
                label="Loading spend"
                className="text-muted-foreground"
              />
            )}
          </p>
          <Tabs
            tabs={PERIOD_TABS}
            value={period}
            onValueChange={setPeriod}
            variant="pill"
            size="sm"
            ariaLabel="Period"
          />
        </div>

        <p className="text-2xl font-semibold tabular-nums text-foreground">
          <TotalValue
            usdMicros={totals.usd}
            ready={data !== undefined && metering !== undefined}
            failed={query.isError}
            measured={measured}
          />
        </p>
        {metering && (
          <div className="mb-5 mt-0.5 flex flex-col gap-1">
            <SpendRangeLine range={range} startDay={metering.startDay} />
            {measured && (
              <SpendSideLines totals={totals} showPlanUse={showPlanUse} />
            )}
          </div>
        )}

        {period === "today" && ownLimit && (
          <div className="mb-5">
            <SpendLimitMeter
              label={OWN_LIMIT_NAME}
              showLabel
              unit="usd"
              spentMicros={ownLimit.spentMicros}
              limitMicros={ownLimit.effectiveMicros}
              state={ownLimit.state}
              extensions={ownLimit.extensions}
            />
          </div>
        )}

        <MeteringNotice className="mb-5" />

        <div className="relative min-h-[132px]">
          <SpendersArea
            byAgent={data?.byAgent}
            failed={query.isError}
            showPlanUse={showPlanUse}
            measured={measured}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border-hairline pt-4">
          <PlanUseCheckbox />
          <ViewDetailsLink period={period} />
        </div>
      </div>
    </MotionConfig>
  );
}

function TotalValue({
  usdMicros,
  ready,
  failed,
  measured,
}: {
  usdMicros: number;
  ready: boolean;
  failed: boolean;
  measured: boolean;
}) {
  if (ready && measured) return <AnimatedUsd value={microsToUsd(usdMicros)} />;
  if (ready || failed) return "—";
  return <TextSkeleton width={96} />;
}

function SpendersArea({
  byAgent,
  failed,
  showPlanUse,
  measured,
}: {
  byAgent: SpendBreakdown["byAgent"] | undefined;
  failed: boolean;
  showPlanUse: boolean;
  measured: boolean;
}) {
  if (byAgent) {
    return (
      <TopSpenders
        byAgent={byAgent}
        showPlanUse={showPlanUse}
        measured={measured}
      />
    );
  }
  if (failed) {
    return <p className="text-sm text-muted-foreground">{SPEND_LOAD_ERROR}</p>;
  }
  return <TopSpendersSkeleton />;
}
