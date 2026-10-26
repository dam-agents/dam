import type { SpendByAgent } from "api-server-api";

import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { formatUsd } from "../lib/format.js";
import { seriesColor } from "../lib/series-color.js";
import { SpendBar } from "./spend-bar.js";

export function AgentSpendBars({ rows }: { rows: SpendByAgent[] }) {
  const max = rows[0]?.costUsd ?? 0;
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, i) => (
        <SpendBar
          key={row.agentId}
          label={row.agentName || row.agentId}
          icon={<AgentAvatar name={row.agentName || row.agentId} size={16} />}
          color={seriesColor(i)}
          pct={max > 0 ? (row.costUsd / max) * 100 : 0}
          value={formatUsd(row.costUsd)}
        />
      ))}
    </div>
  );
}
