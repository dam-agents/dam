import type { SpendByAgent } from "api-server-api";

import { formatUsd } from "../lib/format.js";
import { seriesColor } from "../lib/series-color.js";
import { SpendBar } from "./spend-bar.js";

/** Per-agent spend as bars, widest is the top spender. Rows arrive sorted
 *  highest cost first, so the first row sets the scale. An agent with no
 *  own-name row in the window falls back to its id. */
export function AgentSpendBars({ rows }: { rows: SpendByAgent[] }) {
  const max = rows[0]?.costUsd ?? 0;
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, i) => (
        <SpendBar
          key={row.agentId}
          label={row.agentName || row.agentId}
          color={seriesColor(i)}
          pct={max > 0 ? (row.costUsd / max) * 100 : 0}
          value={formatUsd(row.costUsd)}
        />
      ))}
    </div>
  );
}
