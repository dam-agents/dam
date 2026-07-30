import type { SpendByAgent } from "api-server-api";

import { formatUsd } from "../lib/format.js";

/** One agent's bar: label in a fixed right-aligned gutter, bar in the middle
 *  scaled against the top spender, cost left-aligned after the track. */
function AgentSpendRow({ row, max }: { row: SpendByAgent; max: number }) {
  const label = row.agentName || row.agentId;
  // Percentage of the widest bar, with an 8px floor for any nonzero spend so a
  // tiny value is still visible; zero-cost rows stay empty.
  const pct = max > 0 ? (row.costUsd / max) * 100 : 0;
  return (
    <div className="flex items-center gap-4 text-[14px]">
      <span
        className="w-[140px] shrink-0 truncate text-right text-foreground/80"
        title={label}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="h-5 rounded bg-accent"
          style={{ width: row.costUsd > 0 ? `max(${pct}%, 8px)` : "0px" }}
        />
      </div>
      <span className="w-20 shrink-0 text-left font-mono font-semibold tabular-nums text-foreground">
        {formatUsd(row.costUsd)}
      </span>
    </div>
  );
}

/** Hand-rolled horizontal bars — one per agent, widest is the top spender.
 *  Rows arrive sorted highest cost first, so the first row sets the scale.
 *  Label sits in a fixed left gutter, bar in the middle, cost right-aligned,
 *  matching the Usage design. Deliberately no chart library. */
export function AgentSpendBars({ rows }: { rows: SpendByAgent[] }) {
  const max = rows[0]?.costUsd ?? 0;
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => (
        <AgentSpendRow key={row.agentId} row={row} max={max} />
      ))}
    </div>
  );
}
