import type { TimelineLog, TurnDetail } from "api-server-api";

import { cn } from "@/lib/utils";

import { formatDurationMs, formatUsd } from "../../metrics/lib/format.js";
import { spanColor } from "../lib/span-color.js";
import {
  buildWaterfall,
  logCostUsd,
  logEventLabel,
  logSummary,
  placementOf,
  spanKindLabel,
  type TimelineRow,
} from "../lib/waterfall.js";

function Mark({ log, offsetPct }: { log: TimelineLog; offsetPct: number }) {
  const { label, exact } = placementOf(log);
  return (
    <span
      className="absolute top-0 flex h-4 items-center"
      style={{ left: `${offsetPct}%` }}
      title={label}
    >
      <span
        className={cn(
          "block h-4 w-[2px]",
          exact ? "bg-amber-500" : "bg-amber-500/40",
        )}
        aria-hidden
      />
    </span>
  );
}

function LogContent({ log }: { log: TimelineLog }) {
  const cost = logCostUsd(log);
  const summary = logSummary(log);
  const { exact } = placementOf(log);
  return (
    <>
      {summary}
      {cost !== null && (
        <span className="ml-2 font-medium text-foreground">
          {formatUsd(cost)}
        </span>
      )}
      {!exact && (
        <span className="ml-2 opacity-60" title="Placed by timestamp">
          ~
        </span>
      )}
    </>
  );
}

function RowLabel({ row, indentPx }: { row: TimelineRow; indentPx: number }) {
  if (row.kind === "span") {
    return (
      <span
        className="min-w-0 truncate font-mono text-xs"
        style={{ paddingLeft: `${row.depth * indentPx}px` }}
        title={row.span.name}
      >
        {spanKindLabel(row.span.name)}
      </span>
    );
  }
  const { exact } = placementOf(row.log);
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground"
      title={row.log.event}
    >
      <span
        aria-hidden
        className={cn(
          "text-[9px]",
          exact ? "text-amber-600" : "text-amber-600/50",
        )}
      >
        ◆
      </span>
      <span className="truncate">{logEventLabel(row.log.event)}</span>
    </span>
  );
}

export function TraceWaterfall({
  trace,
  selectedSpanId,
  onSelectSpan,
  compact = false,
}: {
  trace: TurnDetail;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  compact?: boolean;
}) {
  const wf = buildWaterfall(trace);
  const labelCols = compact ? "minmax(0,130px)" : "minmax(0,260px)";
  const indentPx = compact ? 9 : 14;
  const durCol = compact ? "48px" : "60px";

  if (wf.rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        This turn has no records in range.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div
        className={cn(
          "py-3",
          compact ? "min-w-[360px] px-3" : "min-w-[620px] px-4",
        )}
      >
        {wf.rows.map((row) => {
          const isSpan = row.kind === "span";
          const failed = isSpan && row.span.statusCode.includes("ERROR");
          const selected = isSpan && selectedSpanId === row.span.spanId;
          return (
            <div key={row.key}>
              <button
                type="button"
                onClick={() => isSpan && onSelectSpan(row.span.spanId)}
                className={cn(
                  "grid w-full items-center gap-3 rounded-sm py-[3px] text-left",
                  isSpan ? "hover:bg-muted/60" : "cursor-default",
                  selected && "bg-muted",
                )}
                style={{
                  gridTemplateColumns: `${labelCols} 1fr ${durCol}`,
                }}
              >
                <RowLabel row={row} indentPx={indentPx} />
                <span className="relative block h-4 rounded-sm bg-muted/70">
                  {isSpan ? (
                    <span
                      className={cn(
                        "absolute top-[2px] h-3 rounded-[2px]",
                        failed && "outline outline-1 outline-destructive",
                      )}
                      style={{
                        left: `${row.offsetPct}%`,
                        width: `${row.widthPct}%`,
                        backgroundColor: spanColor(row.span.name),
                      }}
                    />
                  ) : (
                    <Mark log={row.log} offsetPct={row.offsetPct} />
                  )}
                </span>
                <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                  {isSpan ? formatDurationMs(row.span.durationMs) : ""}
                </span>
              </button>

              {row.kind === "log" && (
                <div
                  className="grid items-center gap-3 pb-1"
                  style={{ gridTemplateColumns: `${labelCols} 1fr ${durCol}` }}
                >
                  <span />
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    <LogContent log={row.log} />
                  </span>
                  <span />
                </div>
              )}

              {row.kind === "span" &&
                row.logs.map((log, i) => (
                  <div
                    key={`${log.at}-${log.event}-${i}`}
                    className="grid items-center gap-3 py-[2px]"
                    style={{ gridTemplateColumns: `${labelCols} 1fr` }}
                  >
                    <div
                      className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
                      style={{ paddingLeft: `${(row.depth + 1) * indentPx}px` }}
                    >
                      <span aria-hidden className="text-[9px] text-amber-600">
                        ◆
                      </span>
                      <span className="truncate font-mono">
                        {logEventLabel(log.event)}
                      </span>
                      {log.attachedBy === "request-id" && (
                        <span
                          className="shrink-0 rounded-sm bg-muted px-1 text-[9px] uppercase tracking-wide"
                          title="Matched to this call by its request id"
                        >
                          call
                        </span>
                      )}
                    </div>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      <LogContent log={log} />
                    </span>
                  </div>
                ))}
            </div>
          );
        })}

        {wf.traceCount > 1 && (
          <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
            This turn spans {wf.traceCount} traces; rows are placed on one time
            axis.
          </p>
        )}
      </div>
    </div>
  );
}
