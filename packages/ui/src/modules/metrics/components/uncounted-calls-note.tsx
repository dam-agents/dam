import { uncountedCalls } from "../lib/totals.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the calls the total leaves out, shown under it
 * so a reader knows the figure is a floor, not a bill.
 */
export function UncountedCallsNote({
  rows,
}: {
  rows: { uncountedCalls: number }[];
}) {
  const count = uncountedCalls(rows);
  if (count === 0) return null;
  return (
    <p
      className="mt-2 text-xs text-muted-foreground"
      title="Calls with no priced usage: cut short, answered without usage, or on a model with no price"
    >
      {count === 1 ? "1 call uncounted" : `${count} calls uncounted`} in this
      total
    </p>
  );
}
