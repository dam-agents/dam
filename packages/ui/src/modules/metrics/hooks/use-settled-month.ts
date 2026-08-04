import { useRef } from "react";

/** The month the rows currently on screen belong to. While the next month is in
 *  flight the query serves the previous month's rows, so anything keyed by date
 *  — the day chart's buckets — must be plotted against the month those rows came
 *  from. Pairing them with the freshly picked month instead would miss every
 *  bucket and render an empty chart. */
export function useSettledMonth(month: Date, isPlaceholderData: boolean): Date {
  const settled = useRef(month);
  if (!isPlaceholderData) settled.current = month;
  return settled.current;
}
