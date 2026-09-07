import type { SpendBySessionType } from "api-server-api";

import { formatUsd } from "../lib/format.js";
import { seriesColor } from "../lib/series-color.js";
import { SESSION_TYPE_LABELS } from "../lib/session-type-label.js";
import { SpendBar } from "./spend-bar.js";

export function SessionTypeSpendBars({ rows }: { rows: SpendBySessionType[] }) {
  const max = rows[0]?.costUsd ?? 0;
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, i) => (
        <SpendBar
          key={row.category}
          label={SESSION_TYPE_LABELS[row.category]}
          color={seriesColor(i)}
          pct={max > 0 ? (row.costUsd / max) * 100 : 0}
          value={formatUsd(row.costUsd)}
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
