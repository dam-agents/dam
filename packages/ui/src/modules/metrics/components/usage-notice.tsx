import { Card } from "@/components/ui/card";

import { CHART_HEIGHT_CLASS } from "./spend-by-day-chart.js";

/** A Usage surface's stand-in message — unavailable backend, failed read, or an
 *  empty month — at the chart's height so the layout keeps its shape. */
export function UsageNotice({ children }: { children: string }) {
  return (
    <Card
      className={`flex ${CHART_HEIGHT_CLASS} items-center justify-center p-5`}
    >
      <p className="text-sm text-muted-foreground">{children}</p>
    </Card>
  );
}

/** The message for a read that produced nothing, told apart by cause: an
 *  unavailable backend is a deployment verdict, anything else is transient. */
export function readFailureMessage(unavailable: boolean): string {
  return unavailable
    ? "Usage metrics are unavailable on this deployment."
    : "Couldn't load usage right now.";
}
