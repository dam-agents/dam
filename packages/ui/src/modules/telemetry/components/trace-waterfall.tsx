import type { TurnDetail } from "api-server-api";
import { useMemo } from "react";

import { formatDurationMs } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { formatUsd } from "../../metrics/lib/format.js";
import {
  buildWaterfall,
  logCostUsd,
  logEventLabel,
  placementOf,
  rowKeyOf,
  spanKindLabel,
  type TimelineRow,
} from "../lib/waterfall.js";

const KIND_COLORS: Record<string, string> = {
  interaction: "#a56eff",
  llm_request: "#1192e8",
  tool: "#009d9a",
  "tool.execution": "#0f9b98",
  "tool.blocked_on_user": "#b28600",
  hook: "#6929c4",
};

const FALLBACK = "#5f6a7a";

function spanColor(name: string): string {
  const short = name.startsWith("claude_code.") ? name.slice(12) : name;
  return KIND_COLORS[short] ?? FALLBACK;
}

const offsetLabel = (ms: number): string =>
  ms < 1000 ? `+${Math.round(ms)}ms` : `+${(ms / 1000).toFixed(1)}s`;

export function TraceWaterfall({
  turn,
  selectedKey,
  onSelect,
  compact = false,
}: {
  turn: TurnDetail;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  compact?: boolean;
}) {
  const wf = useMemo(() => buildWaterfall(turn), [turn]);
  const labelCols = compact ? "minmax(0,150px)" : "minmax(0,240px)";
  const indentPx = compact ? 10 : 14;
  const metaCol = compact ? "56px" : "68px";

  if (wf.rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        This turn has no records in range.
      </p>
    );
  }

  const render = (row: TimelineRow, depth: number) => {
    const key = rowKeyOf(row);
    const selected = selectedKey === key;
    const isSpan = row.kind === "span";
    const cost = isSpan ? null : logCostUsd(row.log);
    const placement = isSpan ? null : placementOf(row.log);

    return (
      <button
        key={key}
        type="button"
        onClick={() => onSelect(key)}
        aria-expanded={selected}
        className={cn(
          "grid w-full items-center gap-3 rounded-sm py-[3px] text-left hover:bg-muted/60",
          selected && "bg-muted",
        )}
        style={{ gridTemplateColumns: `${labelCols} 1fr ${metaCol}` }}
      >
        <span
          className="flex min-w-0 items-center gap-1.5"
          style={{ paddingLeft: `${depth * indentPx}px` }}
        >
          {!isSpan && (
            <span
              aria-hidden
              className={cn(
                "shrink-0 text-[8px]",
                placement?.exact ? "text-amber-600" : "text-amber-600/45",
              )}
            >
              ◆
            </span>
          )}
          <span
            className={cn(
              "truncate font-mono",
              isSpan ? "text-xs" : "text-[11px] text-muted-foreground",
            )}
            title={isSpan ? row.span.name : row.log.event}
          >
            {isSpan
              ? spanKindLabel(row.span.name)
              : logEventLabel(row.log.event)}
          </span>
          {!isSpan && row.log.attachedBy === "request-id" && (
            <span
              className="shrink-0 rounded-sm bg-muted px-1 text-[9px] uppercase tracking-wide text-muted-foreground"
              title="Matched to this call by its request id"
            >
              call
            </span>
          )}
        </span>

        <span className="relative block h-4 rounded-sm bg-muted/60">
          {isSpan ? (
            <span
              className={cn(
                "absolute top-[2px] h-3 rounded-[2px]",
                row.span.statusCode.includes("ERROR") &&
                  "outline outline-1 outline-destructive",
              )}
              style={{
                left: `${row.offsetPct}%`,
                width: `${row.widthPct}%`,
                backgroundColor: spanColor(row.span.name),
              }}
            />
          ) : (
            <span
              className={cn(
                "absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45",
                placement?.exact ? "bg-amber-500" : "bg-amber-500/45",
              )}
              style={{ left: `${row.offsetPct}%` }}
              title={placement?.label}
            />
          )}
        </span>

        <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
          {isSpan
            ? formatDurationMs(row.span.durationMs)
            : cost !== null
              ? formatUsd(cost)
              : offsetLabel(row.offsetMs)}
        </span>
      </button>
    );
  };

  return (
    <div className="overflow-x-auto">
      <div
        className={cn(
          "py-3",
          compact ? "min-w-[380px] px-3" : "min-w-[620px] px-4",
        )}
      >
        {wf.rows.map((row) => render(row, row.depth))}

        {wf.traceCount > 1 && (
          <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
            This turn spans {wf.traceCount} traces; rows sit on one time axis.
          </p>
        )}
      </div>
    </div>
  );
}
