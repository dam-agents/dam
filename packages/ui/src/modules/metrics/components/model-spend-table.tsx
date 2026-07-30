import type { TokenSpendByModel } from "api-server-api";

import { labelVariants } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { formatTokens, formatUsd, formatUsdCell } from "../lib/format.js";

// Shared cell padding — every header and body cell uses the same box so the
// full-bleed dividers line up and the columns stay on their fixed widths.
const CELL = "px-5 py-3.5";

export function ModelSpendTable({ rows }: { rows: TokenSpendByModel[] }) {
  return (
    <table className="w-full table-fixed border-collapse tabular-nums">
      <thead>
        <tr className={cn(labelVariants(), "border-b border-border-hairline")}>
          <th className={`w-[40%] ${CELL} text-left font-medium`}>Model</th>
          <th className={`w-[20%] ${CELL} text-right font-medium`}>In</th>
          <th className={`w-[20%] ${CELL} text-right font-medium`}>Out</th>
          <th className={`w-[20%] ${CELL} text-right font-medium`}>Cost</th>
        </tr>
      </thead>
      <tbody className="text-[13px]">
        {rows.map((row) => (
          <tr
            key={row.model}
            className="border-b border-border-hairline last:border-b-0"
          >
            <td
              className={`truncate ${CELL} font-mono text-muted-foreground`}
              title={row.model}
            >
              {row.model}
            </td>
            {/* Cache reads dominate agent traffic; fold them into "in" so the
                column reflects what actually entered the context. */}
            <td className={`${CELL} text-right font-mono`}>
              {formatTokens(
                row.inputTokens + row.cacheReadTokens + row.cacheCreationTokens,
              )}
            </td>
            <td className={`${CELL} text-right font-mono`}>
              {formatTokens(row.outputTokens)}
            </td>
            <td
              className={`${CELL} text-right font-mono font-semibold`}
              title={formatUsd(row.costUsd)}
            >
              {formatUsdCell(row.costUsd)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
