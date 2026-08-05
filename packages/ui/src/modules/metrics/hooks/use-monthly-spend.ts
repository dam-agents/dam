import { useState } from "react";

import { useSpendBreakdown } from "../api/queries.js";
import { monthLabel, monthRange, monthStart } from "../lib/month-range.js";
import { useSettledMonth } from "./use-settled-month.js";

/** One month of spend plus the month control's state — the whole stateful half
 *  of a Usage surface. Both surfaces read through here (the global tab
 *  unnarrowed, a sandbox's section narrowed to its own agent) so their loading,
 *  error and placeholder gates cannot drift apart, and so the query's
 *  same-agent placeholder scoping applies wherever the section is mounted. */
export function useMonthlySpend(agentId?: string) {
  const [month, setMonth] = useState(() => monthStart(new Date(), 0));
  const { from, to, isCurrentMonth } = monthRange(month);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // One query backs the whole surface, so per-model / per-agent / per-day spend
  // land together under a single loading/error state — the chart never renders
  // an all-zero month while its data is still in flight.
  const { data, isPending, isError, isPlaceholderData, isUnavailable } =
    useSpendBreakdown(from, to, timeZone, agentId);
  const shownMonth = useSettledMonth(
    month,
    !isPlaceholderData && data !== undefined,
  );

  return {
    month,
    setMonth,
    isCurrentMonth,
    /** The picked month, for the period control and error copy. */
    label: monthLabel(month),
    /** The month the rows on screen belong to — plot date-keyed output against
     *  this, not the month just picked. */
    shownMonth,
    data,
    isPending,
    isError,
    isPlaceholderData,
    unavailable: isUnavailable,
  };
}
