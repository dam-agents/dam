import type { SpendBreakdown } from "api-server-api";

import {
  type ChartColumn,
  SpendByDayChart,
} from "../../metrics/components/spend-by-day-chart.js";
import { bucketTitle } from "../lib/copy.js";
import { spendBuckets } from "../lib/day-buckets.js";
import { microsToUsd } from "../lib/format.js";
import type { DayRange } from "../lib/utc-day.js";

interface Props {
  range: DayRange;
  byDay: SpendBreakdown["byDay"];
  startDay: string;
  today: string;
  showPlanUse: boolean;
}

export function MeasuredDayChart({
  range,
  byDay,
  startDay,
  today,
  showPlanUse,
}: Props) {
  const columns: ChartColumn[] = spendBuckets({
    range,
    byDay,
    startDay,
    today,
  }).map((bucket) => ({
    day: bucket.key,
    costUsd: microsToUsd(bucket.paidMicros),
    planUsd: showPlanUse ? microsToUsd(bucket.planMicros) : 0,
    title: bucketTitle(bucket, showPlanUse),
    axisLabel: bucket.axisLabel,
  }));
  return <SpendByDayChart days={columns} />;
}
