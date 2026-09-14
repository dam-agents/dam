import type { TimelineLog, TraceDetail } from "api-server-api";

import { cn } from "@/lib/utils";

import { formatDurationMs, formatUsd } from "../../metrics/lib/format.js";
import { spanColor } from "../lib/span-color.js";
import {
  buildWaterfall,
  logCostUsd,
  logOffsetPct,
  logSummary,
  spanKindLabel,
} from "../lib/waterfall.js";

function LogLine({
  log,
  offsetPct,
  indent,
  labelCols,
}: {
  log: TimelineLog;
  offsetPct: number;
  indent: number;
  labelCols: string;
}) {
  const cost = logCostUsd(log);
  const summary = logSummary(log);
  return (
    <div
      className="grid items-center gap-3 py-[2px]"
      style={{ gridTemplateColumns: `${labelCols} 1fr` }}
    >
      <div
        className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
        style={{ paddingLeft: `${indent * 12 + 12}px` }}
      >
        <span aria-hidden className="text-[9px] text-amber-600">
          ◆
        </span>
        <span className="truncate font-mono">{log.event}</span>
        {log.attachedBy === "request-id" && (
          <span
            className="shrink-0 rounded-sm bg-muted px-1 text-[9px] uppercase tracking-wide"
            title="Matched to this call by its request id"
          >
            call
          </span>
        )}
      </div>
      <div className="relative h-4">
        <span
          className="absolute top-0 h-4 w-[2px] bg-amber-500"
          style={{ left: `${offsetPct}%` }}
          aria-hidden
        />
        <span className="ml-2 block truncate pl-[2px] font-mono text-[11px] text-muted-foreground">
          {summary}
          {cost !== null && (
            <span className="ml-2 font-medium text-foreground">
              {formatUsd(cost)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

export function TraceWaterfall({
  trace,
  selectedSpanId,
  onSelectSpan,
  compact = false,
}: {
  trace: TraceDetail;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  compact?: boolean;
}) {
  const wf = buildWaterfall(trace);
  const labelCols = compact ? "minmax(0,130px)" : "minmax(0,260px)";
  const indentPx = compact ? 9 : 14;

  if (wf.rows.length === 0 && wf.looseLogs.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        This trace has no records in range.
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
          const failed = row.span.statusCode.includes("ERROR");
          return (
            <div key={row.span.spanId}>
              <button
                type="button"
                onClick={() => onSelectSpan(row.span.spanId)}
                className={cn(
                  "grid w-full items-center gap-3 rounded-sm py-[3px] text-left hover:bg-muted/60",
                  selectedSpanId === row.span.spanId && "bg-muted",
                )}
                style={{
                  gridTemplateColumns: `${labelCols} 1fr ${compact ? "48px" : "60px"}`,
                }}
              >
                <span
                  className="min-w-0 truncate font-mono text-xs"
                  style={{ paddingLeft: `${row.depth * indentPx}px` }}
                  title={row.span.name}
                >
                  {spanKindLabel(row.span.name)}
                </span>
                <span className="relative block h-4 rounded-sm bg-muted/70">
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
                </span>
                <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                  {formatDurationMs(row.span.durationMs)}
                </span>
              </button>
              {row.logs.map((log) => (
                <LogLine
                  key={`${log.at}-${log.event}-${log.spanId}`}
                  log={log}
                  offsetPct={logOffsetPct(log, wf.startMs, wf.totalMs)}
                  indent={row.depth}
                  labelCols={labelCols}
                />
              ))}
            </div>
          );
        })}

        {wf.looseLogs.length > 0 && (
          <div className="mt-3 border-t border-border pt-2">
            <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Not attached to a span
            </p>
            {wf.looseLogs.map((log) => (
              <LogLine
                key={`${log.at}-${log.event}`}
                log={log}
                offsetPct={logOffsetPct(log, wf.startMs, wf.totalMs)}
                indent={0}
                labelCols={labelCols}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
