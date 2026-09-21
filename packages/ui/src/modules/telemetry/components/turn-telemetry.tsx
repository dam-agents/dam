import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import type { TurnSummary } from "api-server-api";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import {
  formatDurationMs,
  formatTokens,
  formatUsdCell,
} from "../../metrics/lib/format.js";
import { useTurn } from "../api/queries.js";
import { RecordDetail, SpanDetail } from "./record-detail.js";
import { TraceWaterfall } from "./trace-waterfall.js";

function summaryBits(turn: TurnSummary): string[] {
  const bits = [formatDurationMs(turn.durationMs)];
  if (turn.calls > 0) {
    bits.push(turn.calls === 1 ? "1 call" : `${turn.calls} calls`);
  }
  const tokens = turn.inputTokens + turn.outputTokens;
  if (tokens > 0) bits.push(`${formatTokens(tokens)} tokens`);
  if (turn.costUsd > 0) bits.push(formatUsdCell(turn.costUsd));
  return bits;
}

export function TurnTelemetry({
  agentId,
  sessionId,
  turn,
}: {
  agentId: string;
  sessionId: string;
  turn: TurnSummary;
}) {
  const [open, setOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const detail = useTurn(
    agentId,
    sessionId,
    open ? turn.startedAt : null,
    open ? turn.endedAt : null,
    turn.promptId,
  );
  const loaded = detail.data?.available === true ? detail.data.turn : undefined;
  const selectedSpan = useMemo(
    () =>
      selectedKey?.startsWith("span:") === true
        ? loaded?.spans.find((s) => `span:${s.spanId}` === selectedKey)
        : undefined,
    [loaded, selectedKey],
  );
  const selectedLog = useMemo(
    () =>
      selectedKey?.startsWith("log:") === true
        ? loaded?.logs.find((l) => selectedKey.includes(`:${l.at}:${l.event}:`))
        : undefined,
    [loaded, selectedKey],
  );

  return (
    <div className="-mt-7">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "group inline-flex items-center gap-1.5 rounded-sm py-0.5 text-[11px] text-muted-foreground/70",
          "hover:text-foreground focus-visible:text-foreground",
        )}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-mono tabular-nums">
          {summaryBits(turn).join(" · ")}
        </span>
        {turn.errorCount > 0 && (
          <span className="font-mono text-destructive">
            {turn.errorCount} err
          </span>
        )}
      </button>

      {open && (
        <div className="mt-1 overflow-hidden rounded-md border border-border bg-muted/20">
          {detail.isPending && (
            <p className="px-3 py-3 text-[11px] text-muted-foreground">
              Loading…
            </p>
          )}
          {detail.isError && (
            <p className="px-3 py-3 text-[11px] text-muted-foreground">
              Couldn’t load this turn’s telemetry.
            </p>
          )}
          {detail.data?.available === false && (
            <p className="px-3 py-3 text-[11px] text-muted-foreground">
              {detail.data.reason}
            </p>
          )}
          {loaded && (
            <>
              <TraceWaterfall
                turn={loaded}
                selectedKey={selectedKey}
                onSelect={(key) =>
                  setSelectedKey((current) => (current === key ? null : key))
                }
              />
              {(loaded.spansTruncated || loaded.logsTruncated) && (
                <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                  This turn is larger than the display cap; some records are not
                  shown.
                </p>
              )}
              {selectedSpan && (
                <div className="border-t border-border">
                  <SpanDetail trace={loaded} span={selectedSpan} />
                </div>
              )}
              {selectedLog && (
                <div className="border-t border-border">
                  <RecordDetail log={selectedLog} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
