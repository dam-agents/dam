import type { UsageFreshness } from "../hooks/use-monthly-spend.js";

export function readFailureMessage(
  unavailable: boolean,
  monthLabel: string,
): string {
  return unavailable
    ? "Agent spend reports are not collected on this deployment. Spend limits still work."
    : `Couldn't load usage for ${monthLabel}.`;
}

export function UsageStaleLabel({ freshness }: { freshness: UsageFreshness }) {
  if (freshness === "fresh") return null;
  return (
    <span className="text-xs text-muted-foreground">
      {freshness === "updating" ? "Updating…" : "Couldn't refresh"}
    </span>
  );
}
