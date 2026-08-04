import { useRef } from "react";

/** The month the rows currently on screen belong to. While the next month is in
 *  flight the query serves an earlier month's rows, so anything keyed by date —
 *  the day chart's buckets — must be plotted against the month those rows came
 *  from. Pairing them with the freshly picked month instead would miss every
 *  bucket and render an empty chart.
 *
 *  `hasOwnData` must mean *this* month resolved, not merely "no placeholder
 *  showing": a month that errored shows no placeholder either, and
 *  `keepPreviousData` then reaches past it to the last month that did have rows —
 *  so settling on the errored month would mismatch the two. */
export function useSettledMonth(month: Date, hasOwnData: boolean): Date {
  const settled = useRef(month);
  if (hasOwnData) settled.current = month;
  return settled.current;
}
