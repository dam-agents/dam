import { useRef, useState } from "react";

import { useSpendBreakdown } from "../api/queries.js";
import { monthLabel, monthRange, monthStart } from "../lib/month-range.js";

type UsageState = "unavailable" | "failed" | "loading" | "ready";

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
  const settledMonth = useRef(month);
  if (!isPlaceholderData && data !== undefined) settledMonth.current = month;
  const shownMonth = settledMonth.current;

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
