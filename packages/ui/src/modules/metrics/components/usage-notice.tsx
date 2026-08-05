import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

import { CHART_HEIGHT_CLASS } from "./spend-by-day-chart.js";

/** One-line message at the day chart's height, so standing in for a chart — or
 *  for a whole Usage surface — doesn't collapse the layout. */
export function UsageNotice({ children }: { children: ReactNode }) {
  return (
    <Card
      className={`flex ${CHART_HEIGHT_CLASS} items-center justify-center p-5`}
    >
      <p className="text-sm text-muted-foreground">{children}</p>
    </Card>
  );
}

/** The message for a read that produced nothing, told apart by cause: an
 *  unavailable backend is a deployment verdict, anything else is transient and
 *  names the month that failed. */
export function readFailureMessage(
  unavailable: boolean,
  monthLabel: string,
): string {
  return unavailable
    ? "Usage metrics are unavailable on this deployment."
    : `Couldn't load usage for ${monthLabel}.`;
}

/** Names why the figures beside it are not the picked month's own — the figures
 *  stay legible, which dimming them cost: at 40% opacity the muted body copy
 *  fell under the AA contrast minimum. */
export function UsageStaleLabel({
  isPlaceholderData,
  isError,
}: {
  isPlaceholderData: boolean;
  isError: boolean;
}) {
  const text = isPlaceholderData
    ? "Updating…"
    : isError
      ? "Couldn't refresh"
      : undefined;
  if (!text) return null;
  return <span className="text-xs text-muted-foreground">{text}</span>;
}
