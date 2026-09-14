import type { TraceSummary } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PanelCard } from "@/components/ui/panel-card";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { formatDurationMs, formatUsdCell } from "../../metrics/lib/format.js";
import { downloadTimelineExport } from "../api/download-export.js";
import { useTrace, useTraces } from "../api/queries.js";
import { SpanDetail } from "../components/span-detail.js";
import { TraceWaterfall } from "../components/trace-waterfall.js";
import { spanKindLabel } from "../lib/waterfall.js";

const WINDOWS = [
  { hours: 24, label: "Last 24 hours" },
  { hours: 24 * 7, label: "Last 7 days" },
  { hours: 24 * 30, label: "Last 30 days" },
];

function TraceRow({
  trace,
  active,
  onSelect,
}: {
  trace: TraceSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const started = new Date(trace.startedAt);
  const clock = Number.isNaN(started.getTime())
    ? trace.startedAt
    : started.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-0.5 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted/60",
        active && "bg-muted",
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-xs">
          {spanKindLabel(trace.rootName) || "trace"}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatDurationMs(trace.durationMs)}
        </span>
      </span>
      <span className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="font-mono">{clock}</span>
        <span className="flex shrink-0 items-center gap-2 font-mono tabular-nums">
          {trace.errorCount > 0 && (
            <span className="text-destructive">{trace.errorCount} err</span>
          )}
          <span>{trace.spanCount} spans</span>
          {trace.costUsd > 0 && <span>{formatUsdCell(trace.costUsd)}</span>}
        </span>
      </span>
    </button>
  );
}

export function SandboxTimelineSection({ agentId }: { agentId: string }) {
  const [sinceHours, setSinceHours] = useState(24);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selected, setSelected] = useState<TraceSummary | null>(null);
  const [spanId, setSpanId] = useState<string | null>(null);

  const traces = useTraces(agentId, sessionId, sinceHours, true);
  const detail = useTrace(
    agentId,
    selected?.traceId ?? null,
    selected?.startedAt ?? null,
  );

  const unavailable =
    traces.data !== undefined && traces.data.available === false;
  const rows = traces.data?.available === true ? traces.data.traces : [];

  const sessions = [
    ...new Set(rows.flatMap((t) => t.sessionIds).filter((s) => s !== "")),
  ].sort();

  const trace = detail.data?.available === true ? detail.data.trace : undefined;
  const span = trace?.spans.find((s) => s.spanId === spanId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionLabel>Timeline</SectionLabel>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-[150px]">
            <Select
              size="sm"
              aria-label="Time window"
              value={String(sinceHours)}
              onChange={(e) => {
                setSinceHours(Number(e.target.value));
                setSelected(null);
              }}
            >
              {WINDOWS.map((w) => (
                <option key={w.hours} value={w.hours}>
                  {w.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-[190px]">
            <Select
              size="sm"
              aria-label="Session"
              value={sessionId ?? ""}
              onChange={(e) => {
                setSessionId(e.target.value === "" ? null : e.target.value);
                setSelected(null);
              }}
            >
              <option value="">All sessions</option>
              {sessions.map((s) => (
                <option key={s} value={s}>
                  {s.slice(0, 8)}…
                </option>
              ))}
            </Select>
          </div>
          <Button
            size="sm"
            variant="outline"
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
            Export logs
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={unavailable}
            onClick={() =>
              void downloadTimelineExport({
                agentId,
                sessionId,
                signal: "spans",
                sinceHours,
              })
            }
          >
            Export spans
          </Button>
        </div>
      </div>

      {unavailable && (
        <Callout tone="info">
          {traces.data?.available === false
            ? traces.data.reason
            : "Telemetry is not available on this deployment."}
        </Callout>
      )}

      {!unavailable && traces.isError && (
        <Callout tone="warning">
          Couldn’t load the timeline for this agent.
        </Callout>
      )}

      {!unavailable && !traces.isError && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <PanelCard
            title="Turns"
            headerRight={
              traces.isFetching ? <Spinner /> : <span>{rows.length}</span>
            }
          >
            <div className="max-h-[520px] overflow-y-auto">
              {traces.isPending && (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  Loading…
                </p>
              )}
              {!traces.isPending && rows.length === 0 && (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  No telemetry for this agent in the selected window. The store
                  keeps 30 days.
                </p>
              )}
              {rows.map((t) => (
                <TraceRow
                  key={t.traceId}
                  trace={t}
                  active={selected?.traceId === t.traceId}
                  onSelect={() => {
                    setSelected(t);
                    setSpanId(null);
                  }}
                />
              ))}
            </div>
            {traces.data?.available === true && traces.data.truncated && (
              <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                Showing the most recent {rows.length}. Narrow the window to see
                older turns.
              </p>
            )}
          </PanelCard>

          <div className="flex min-w-0 flex-col gap-4">
            <PanelCard
              title={selected ? "Trace" : "Select a turn"}
              headerRight={
                trace ? (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {trace.spans.length} spans · {trace.logs.length} records ·{" "}
                    {formatDurationMs(trace.durationMs)}
                  </span>
                ) : undefined
              }
            >
              {!selected && (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  Pick a turn to see its spans and the log records attached to
                  them.
                </p>
              )}
              {selected && detail.isPending && (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  Loading trace…
                </p>
              )}
              {selected && detail.isError && (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  That trace is no longer in the store.
                </p>
              )}
              {trace && (
                <>
                  <TraceWaterfall
                    trace={trace}
                    selectedSpanId={spanId}
                    onSelectSpan={setSpanId}
                  />
                  {(trace.spansTruncated || trace.logsTruncated) && (
                    <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                      This trace is larger than the display cap; some records
                      are not shown.
                    </p>
                  )}
                </>
              )}
            </PanelCard>

            {trace && span && (
              <PanelCard title="Span">
                <SpanDetail trace={trace} span={span} />
              </PanelCard>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
