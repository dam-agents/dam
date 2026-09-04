import type { SpendBySessionType } from "api-server-api";

import { formatSpend, spendBarPct } from "../lib/format.js";
import { seriesColor } from "../lib/series-color.js";
import { SESSION_TYPE_LABELS } from "../lib/session-type-label.js";
import { SpendBar } from "./spend-bar.js";

export function SessionTypeSpendBars({ rows }: { rows: SpendBySessionType[] }) {
  const pcts = spendBarPct(rows);
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, i) => (
        <SpendBar
          key={row.category}
          label={SESSION_TYPE_LABELS[row.category]}
          color={seriesColor(i)}
          pct={pcts[i]}
          value={formatSpend(row.costUsd, row.credits)}
        />
      ))}
      {rows.some((row) => row.category === "unknown") && (
        <p className="text-xs text-muted-foreground">
          Unattributed spend comes from sessions the platform has no type for —
          agents that have not reported since this breakdown shipped, and runs
          whose agent was deleted.
        </p>
      )}
    </div>
  );
}
