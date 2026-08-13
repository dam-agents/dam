import { ArrowRight } from "@carbon/icons-react";
import type { TokenSpendByModel } from "api-server-api";

import { formatTokens, formatUsd } from "../lib/format.js";
import { seriesColor } from "../lib/series-color.js";
import { SpendBar } from "./spend-bar.js";

export function ModelSpendBars({ rows }: { rows: TokenSpendByModel[] }) {
  const max = rows[0]?.costUsd ?? 0;
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, i) => (
        <SpendBar
          key={row.model}
          label={row.model}
          color={seriesColor(i)}
          pct={max > 0 ? (row.costUsd / max) * 100 : 0}
          value={formatUsd(row.costUsd)}
          caption={
            <>
              {}
              {formatTokens(
                row.inputTokens + row.cacheReadTokens + row.cacheCreationTokens,
              )}
              <ArrowRight size={12} className="shrink-0" aria-hidden="true" />
              <span className="sr-only">to</span>
              {formatTokens(row.outputTokens)}
            </>
          }
        />
      ))}
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        Bar length is share of the top model · tokens as in
        <ArrowRight size={12} className="shrink-0" aria-hidden="true" />
        <span className="sr-only">to</span>
        out
      </p>
    </div>
  );
}
