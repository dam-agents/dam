import { ArrowLeft, Close, Download } from "@carbon/icons-react";
import type { TurnSummary } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

import { useStore } from "../../../store.js";
import { formatDurationMs, formatUsdCell } from "../../metrics/lib/format.js";
import { downloadTimelineExport } from "../api/download-export.js";
import { useTurn, useTurns } from "../api/queries.js";
import { SpanDetail } from "./span-detail.js";
import { TraceWaterfall } from "./trace-waterfall.js";

const WINDOWS = [
  { hours: 24, label: "24h" },
  { hours: 24 * 7, label: "7d" },
  { hours: 24 * 30, label: "30d" },
];

function shapeLabel(turn: TurnSummary): string {
  if (turn.spanCount > 0 && turn.recordCount > 0) {
    return `${turn.spanCount} spans · ${turn.recordCount} records`;
  }
  if (turn.spanCount > 0) return `${turn.spanCount} spans`;
  return `${turn.recordCount} records`;
}

function TurnRow({
  turn,
  index,
  onOpen,
}: {
  turn: TurnSummary;
  index: number;
  onOpen: () => void;
}) {
  const started = new Date(turn.startedAt);
  const clock = Number.isNaN(started.getTime())
    ? turn.startedAt
    : started.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-0.5 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted/60"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium">
          {turn.prompted
            ? `Turn ${index + 1}`
            : `Turn ${index + 1} (no prompt)`}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatDurationMs(turn.durationMs)}
        </span>
      </span>
      <span className="flex items-baseline justify-between gap-2 font-mono text-[11px] text-muted-foreground">
        <span>{clock}</span>
        <span className="flex shrink-0 items-center gap-2 tabular-nums">
          {turn.errorCount > 0 && (
            <span className="text-destructive">{turn.errorCount} err</span>
          )}
          <span>{shapeLabel(turn)}</span>
          {turn.costUsd > 0 && <span>{formatUsdCell(turn.costUsd)}</span>}
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
  const [sinceHours, setSinceHours] = useState(24);
  const [open, setOpen] = useState<TurnSummary | null>(null);
  const [spanId, setSpanId] = useState<string | null>(null);

  const turns = useTurns(agentId, sessionId, sinceHours);
  const unavailable =
    turns.data !== undefined && turns.data.available === false;
  const rows =
    !unavailable && turns.data?.available === true ? turns.data.turns : [];

  const detail = useTurn(
    agentId,
    sessionId,
    open?.startedAt ?? null,
    open?.endedAt ?? null,
  );
  const turn = detail.data?.available === true ? detail.data.turn : undefined;
  const span = turn?.spans.find((s) => s.spanId === spanId);

  const openIndex =
    open === null ? -1 : rows.findIndex((t) => t.turnId === open.turnId);
  const windowLabel =
    WINDOWS.find((w) => w.hours === sinceHours)?.label ?? "window";
  const live =
    open === null
      ? turns.isFetching && rows.length > 0
      : detail.isFetching && turn !== undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border px-3">
        {open !== null && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Back to turns"
            onClick={() => {
              setOpen(null);
              setSpanId(null);
            }}
          >
            <ArrowLeft size={16} />
          </Button>
        )}
        <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-sm font-medium">
          {open === null
            ? "Timeline"
            : `Turn ${openIndex >= 0 ? openIndex + 1 : ""}`.trim()}
          {live && (
            <span
              className="shrink-0 opacity-60"
              title="Checking for new records"
            >
              <Spinner />
            </span>
          )}
        </span>
        {open === null && (
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
              {turns.data?.available === false
                ? turns.data.reason
                : "Telemetry is not available on this deployment."}
            </Callout>
          </div>
        )}

        {!unavailable && open === null && (
          <>
            {turns.isPending && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                Loading…
              </p>
            )}
            {turns.isError && rows.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                Couldn’t load this session’s timeline.
              </p>
            )}
            {!turns.isPending && !turns.isError && rows.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No telemetry for this session in the last {windowLabel}. The
                store keeps 30 days.
              </p>
            )}
            {rows.map((t, i) => (
              <TurnRow
                key={t.turnId}
                turn={t}
                index={i}
                onOpen={() => {
                  setOpen(t);
                  setSpanId(null);
                }}
              />
            ))}
            {turns.data?.available === true && turns.data.truncated && (
              <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                Showing the most recent {rows.length}. Narrow the window to see
                earlier turns.
              </p>
            )}
          </>
        )}

        {!unavailable && open !== null && (
          <>
            {detail.isPending && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                Loading turn…
              </p>
            )}
            {detail.isError && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                Couldn’t load this turn. It may have aged out of the store, or
                the request was rejected — the browser console has the reason.
              </p>
            )}
            {turn && (
              <>
                <TraceWaterfall
                  trace={turn}
                  selectedSpanId={spanId}
                  onSelectSpan={(id) =>
                    setSpanId((current) => (current === id ? null : id))
                  }
                  compact
                />
                {(turn.spansTruncated || turn.logsTruncated) && (
                  <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                    This turn is larger than the display cap; some records are
                    not shown.
                  </p>
                )}
                {span && (
                  <div className="border-t border-border">
                    <SpanDetail trace={turn} span={span} />
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
