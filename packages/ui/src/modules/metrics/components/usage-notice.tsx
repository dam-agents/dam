import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

import { getBrand } from "../../../brand.js";
import type { UsageFreshness } from "../hooks/use-monthly-spend.js";
import { CHART_HEIGHT_CLASS } from "./spend-by-day-chart.js";

export function UsageNotice({ children }: { children: ReactNode }) {
  return (
    <Card
      className={`flex ${CHART_HEIGHT_CLASS} items-center justify-center p-5`}
    >
      <p className="text-sm text-muted-foreground">{children}</p>
    </Card>
  );
}

export function readFailureMessage(
  unavailable: boolean,
  monthLabel: string,
): string {
  return unavailable
    ? "Agent spend reports are not collected on this deployment. Spend limits still work."
    : `Couldn't load usage for ${monthLabel}.`;
}

export function HarnessReportsLead() {
  return (
    <p className="mb-3 text-sm text-muted-foreground">
      The figures below come from each agent's own reports, for every harness.
      Spend limits use the spend that {getBrand().name} measures, shown above.
    </p>
  );
}

export function UsageStaleLabel({ freshness }: { freshness: UsageFreshness }) {
  if (freshness === "fresh") return null;
  return (
    <span className="text-xs text-muted-foreground">
      {freshness === "updating" ? "Updating…" : "Couldn't refresh"}
    </span>
  );
}
