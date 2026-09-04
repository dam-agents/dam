import type { SpendByAgent } from "api-server-api";

import { formatSpend, spendBarPct } from "../lib/format.js";
import { seriesColor } from "../lib/series-color.js";
import { SpendBar } from "./spend-bar.js";

export function AgentSpendBars({ rows }: { rows: SpendByAgent[] }) {
  const pcts = spendBarPct(rows);
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, i) => (
        <SpendBar
          key={row.agentId}
          label={row.agentName || row.agentId}
          color={seriesColor(i)}
          pct={pcts[i]}
          value={formatSpend(row.costUsd, row.credits)}
        />
      ))}
    </div>
  );
}
