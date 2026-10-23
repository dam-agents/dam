import { useState } from "react";

import { useSpendBreakdown } from "../api/queries.js";
import { monthLabel, monthRange, monthStart } from "../lib/month-range.js";
import { useSettledMonth } from "./use-settled-month.js";

export type UsageState = "unavailable" | "failed" | "loading" | "ready";

export type UsageFreshness = "fresh" | "updating" | "failed";

export function useMonthlySpend(agentId?: string) {
  const [month, setMonth] = useState(() => monthStart(new Date(), 0));
  const { from, to, isCurrentMonth } = monthRange(month);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data, isError, isPlaceholderData, isUnavailable } = useSpendBreakdown(
    from,
    to,
    timeZone,
    agentId,
  );
  const shownMonth = useSettledMonth(
    month,
    !isPlaceholderData && data !== undefined,
  );

  const state: UsageState = isUnavailable
    ? "unavailable"
    : data !== undefined
      ? "ready"
      : isError
        ? "failed"
        : "loading";

  return {
    month,
    setMonth,
    isCurrentMonth,
    label: monthLabel(month),
    shownMonth,
    data,
    state,
    freshness: (isPlaceholderData
      ? "updating"
      : isError
        ? "failed"
        : "fresh") as UsageFreshness,
  };
}
