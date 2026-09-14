import { ArrowLeft, Close, Download } from "@carbon/icons-react";
import type { TraceSummary } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

import { useStore } from "../../../store.js";
import { formatDurationMs, formatUsdCell } from "../../metrics/lib/format.js";
import { downloadTimelineExport } from "../api/download-export.js";
import { useTrace, useTraces } from "../api/queries.js";
import { spanKindLabel } from "../lib/waterfall.js";
import { SpanDetail } from "./span-detail.js";
import { TraceWaterfall } from "./trace-waterfall.js";

const WINDOWS = [
  { hours: 24, label: "24h" },
  { hours: 24 * 7, label: "7d" },
  { hours: 24 * 30, label: "30d" },
];

function TurnRow({
  trace,
  onOpen,
}: {
  trace: TraceSummary;
  onOpen: () => void;
}) {
  const started = new Date(trace.startedAt);
  const clock = Number.isNaN(started.getTime())
    ? trace.startedAt
    : started.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-0.5 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted/60"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-xs">
          {spanKindLabel(trace.rootName) || "trace"}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatDurationMs(trace.durationMs)}
        </span>
      </span>
      <span className="flex items-baseline justify-between gap-2 font-mono text-[11px] text-muted-foreground">
        <span>{clock}</span>
        <span className="flex shrink-0 items-center gap-2 tabular-nums">
          {trace.errorCount > 0 && (
            <span className="text-destructive">{trace.errorCount} err</span>
          )}
          <span>
            {trace.spanCount > 0
              ? `${trace.spanCount} spans`
              : `${trace.recordCount} records`}
          </span>
          {trace.costUsd > 0 && <span>{formatUsdCell(trace.costUsd)}</span>}
        </span>
      </span>
    </button>
  );
}

export function SessionTimelinePanel({
  agentId,
  sessionId,
}: {
  agentId: string;
  sessionId: string;
}) {
  const setTimelineSession = useStore((s) => s.setTimelineSession);
  const openTraceId = useStore((s) => s.openTimelineTraceId);
  const setOpenTrace = useStore((s) => s.setOpenTimelineTrace);
  const [sinceHours, setSinceHours] = useState(24);
  const [spanId, setSpanId] = useState<string | null>(null);

  const traces = useTraces(agentId, sessionId, sinceHours, true);
  const unavailable =
    traces.data !== undefined && traces.data.available === false;
  const rows =
    !unavailable && traces.data?.available === true ? traces.data.traces : [];

  const openSummary = rows.find((t) => t.traceId === openTraceId) ?? null;
  const detail = useTrace(agentId, openTraceId, openSummary?.startedAt ?? null);
  const trace = detail.data?.available === true ? detail.data.trace : undefined;
  const span = trace?.spans.find((s) => s.spanId === spanId);

  const windowLabel =
    WINDOWS.find((w) => w.hours === sinceHours)?.label ?? "window";
  const live =
    openTraceId === null
      ? traces.isFetching && rows.length > 0
      : detail.isFetching && trace !== undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border px-3">
        {openTraceId !== null && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Back to traces"
            onClick={() => {
              setOpenTrace(null);
              setSpanId(null);
            }}
          >
            <ArrowLeft size={16} />
          </Button>
        )}
        <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-sm font-medium">
          {openTraceId === null ? "Timeline" : "Trace"}
          {live && (
            <span
              className="shrink-0 opacity-60"
              title="Checking for new records"
            >
              <Spinner />
            </span>
          )}
        </span>
        {openTraceId === null && (
          <div className="w-[72px] shrink-0">
            <Select
              size="xs"
              aria-label="Time window"
              value={String(sinceHours)}
              onChange={(e) => setSinceHours(Number(e.target.value))}
            >
              {WINDOWS.map((w) => (
                <option key={w.hours} value={w.hours}>
                  {w.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Export this session's log records"
          disabled={unavailable}
          onClick={() =>
            void downloadTimelineExport({
              agentId,
              sessionId,
              signal: "logs",
              sinceHours,
            })
          }
        >
          <Download size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close timeline"
          onClick={() => setTimelineSession(null)}
        >
          <Close size={16} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {unavailable && (
          <div className="p-3">
            <Callout tone="info">
              {traces.data?.available === false
                ? traces.data.reason
                : "Telemetry is not available on this deployment."}
            </Callout>
          </div>
        )}

        {!unavailable && openTraceId === null && (
          <>
            {traces.isPending && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                Loading…
              </p>
            )}
            {traces.isError && rows.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                Couldn’t load this session’s timeline.
              </p>
            )}
            {!traces.isPending && !traces.isError && rows.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No telemetry for this session in the last {windowLabel}. The
                store keeps 30 days.
              </p>
            )}
            {rows.map((t) => (
              <TurnRow
                key={t.traceId}
                trace={t}
                onOpen={() => {
                  setOpenTrace(t.traceId);
                  setSpanId(null);
                }}
              />
            ))}
          </>
        )}

        {!unavailable && openTraceId !== null && (
          <>
            {detail.isPending && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                Loading trace…
              </p>
            )}
            {detail.isError && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                Couldn’t load this trace. It may have aged out of the store, or
                the request was rejected — the browser console has the reason.
              </p>
            )}
            {trace && (
              <>
                <TraceWaterfall
                  trace={trace}
                  selectedSpanId={spanId}
                  onSelectSpan={(id) =>
                    setSpanId((current) => (current === id ? null : id))
                  }
                  compact
                />
                {(trace.spansTruncated || trace.logsTruncated) && (
                  <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                    This trace is larger than the display cap; some records are
                    not shown.
                  </p>
                )}
                {span && (
                  <div className="border-t border-border">
                    <SpanDetail trace={trace} span={span} />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
