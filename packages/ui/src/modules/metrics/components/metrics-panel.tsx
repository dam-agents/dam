import type {
  CallContext,
  SessionRuntime,
  SpendByAgent,
  SpendByDay,
  TokenSpendByModel,
} from "api-server-api";
import { useState } from "react";

import { useMetricsOverview } from "../api/queries.js";
import {
  formatAxisUsd,
  formatDurationMs,
  formatTokens,
  formatUsd,
  formatUsdCell,
} from "../lib/format.js";

interface Props {
  agentId: string | null;
  sessionId: string | null;
}

type MetricsScope = "session" | "all";

/** Right-sidebar metrics tab: token spend per model, session totals, and
 *  the most recent LLM calls for the selected agent, all-time. Scoped to the
 *  current session or to all of the agent's sessions. */
export function MetricsPanel({ agentId, sessionId }: Props) {
  const [scope, setScope] = useState<MetricsScope>("session");
  const sessionScope = sessionId !== null && scope === "session";
  const { data, isPending, isError } = useMetricsOverview(agentId, {
    limit: 25,
    ...(sessionScope ? { sessionId } : {}),
  });

  if (!agentId)
    return (
      <PanelBody toggle={null}>
        <PanelNotice>Select an agent to see metrics</PanelNotice>
      </PanelBody>
    );

  const scopeToggle = sessionId !== null && (
    <ScopeToggle scope={scope} onChange={setScope} />
  );

  if (isError)
    return (
      <PanelBody toggle={scopeToggle}>
        <PanelNotice>Metrics are unavailable right now</PanelNotice>
      </PanelBody>
    );
  if (isPending)
    return (
      <PanelBody toggle={scopeToggle}>
        <PanelNotice>Loading metrics…</PanelNotice>
      </PanelBody>
    );
  if (data.tokenSpendByModel.length === 0)
    return (
      <PanelBody toggle={scopeToggle}>
        <PanelNotice>
          {sessionScope
            ? "No LLM calls in this session"
            : "No LLM calls from this agent yet"}
        </PanelNotice>
      </PanelBody>
    );

  // Session scope can return several rows: the session itself plus child runs
  // (subshell `claude -p`, dam-run) folded in via shared trace context — sum
  // them so the totals cover everything the session spawned.
  const session =
    sessionScope && data.runtimeBySession.length > 0
      ? data.runtimeBySession.reduce((a, r) => ({
          ...a,
          calls: a.calls + r.calls,
          totalDurationMs: a.totalDurationMs + r.totalDurationMs,
          inputTokens: a.inputTokens + r.inputTokens,
          outputTokens: a.outputTokens + r.outputTokens,
          cacheReadTokens: a.cacheReadTokens + r.cacheReadTokens,
          cacheCreationTokens: a.cacheCreationTokens + r.cacheCreationTokens,
          costUsd: a.costUsd + r.costUsd,
        }))
      : null;

  return (
    <PanelBody toggle={scopeToggle}>
      <SectionHeading>Spend by model</SectionHeading>
      <ModelSpendTable rows={data.tokenSpendByModel} />
      {session && (
        <>
          <SectionHeading>Session totals</SectionHeading>
          <SessionStats session={session} />
        </>
      )}
      <SectionHeading>Recent calls</SectionHeading>
      <RecentCallsTable rows={data.contextPerCall} />
    </PanelBody>
  );
}

function PanelBody({
  toggle,
  children,
}: {
  toggle: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 text-[12px]">
      {toggle}
      {children}
    </div>
  );
}

function ScopeToggle({
  scope,
  onChange,
}: {
  scope: MetricsScope;
  onChange: (scope: MetricsScope) => void;
}) {
  const options: [MetricsScope, string][] = [
    ["session", "This session"],
    ["all", "All sessions"],
  ];
  return (
    <div className="mb-3 flex rounded border border-border-light p-0.5">
      {options.map(([value, label]) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={`flex-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors ${scope === value ? "bg-accent-light text-accent" : "text-text-muted hover:text-text-secondary"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function PanelNotice({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[12px] text-text-muted">{children}</p>;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-4 mb-2 text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted first:mt-0">
      {children}
    </h3>
  );
}

export function ModelSpendTable({ rows }: { rows: TokenSpendByModel[] }) {
  return (
    <table className="w-full table-fixed border-collapse tabular-nums">
      <thead>
        <tr className="border-b border-border-hairline text-[11px] uppercase tracking-wide text-text-muted">
          <th className="w-[40%] px-5 py-3.5 text-left font-medium">Model</th>
          <th className="w-[20%] px-5 py-3.5 text-right font-medium">In</th>
          <th className="w-[20%] px-5 py-3.5 text-right font-medium">Out</th>
          <th className="w-[20%] px-5 py-3.5 text-right font-medium">Cost</th>
        </tr>
      </thead>
      <tbody className="text-[13px]">
        {rows.map((row) => (
          <tr
            key={row.model}
            className="border-b border-border-hairline last:border-b-0"
          >
            <td
              className="truncate px-5 py-3.5 font-mono text-text-secondary"
              title={row.model}
            >
              {row.model}
            </td>
            {/* Cache reads dominate agent traffic; fold them into "in" so the
                column reflects what actually entered the context. */}
            <td className="px-5 py-3.5 text-right font-mono">
              {formatTokens(
                row.inputTokens + row.cacheReadTokens + row.cacheCreationTokens,
              )}
            </td>
            <td className="px-5 py-3.5 text-right font-mono">
              {formatTokens(row.outputTokens)}
            </td>
            <td
              className="px-5 py-3.5 text-right font-mono font-semibold"
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

/** Hand-rolled horizontal bars — one per agent, widest is the top spender.
 *  Rows arrive sorted highest cost first, so the first row sets the scale.
 *  Label sits in a fixed left gutter, bar in the middle, cost right-aligned,
 *  matching the Usage design. Deliberately no chart library. */
export function AgentSpendBars({ rows }: { rows: SpendByAgent[] }) {
  const max = rows[0]?.costUsd ?? 0;
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => {
        const label = row.agentName || row.agentId;
        // Percentage of the widest bar, with an 8px floor for any nonzero
        // spend so a tiny value is still visible; zero-cost rows stay empty.
        const pct = max > 0 ? (row.costUsd / max) * 100 : 0;
        return (
          <div
            key={row.agentId}
            className="flex items-center gap-4 text-[14px]"
          >
            <span
              className="w-[140px] shrink-0 truncate text-right text-foreground/80"
              title={label}
            >
              {label}
            </span>
            <div className="min-w-0 flex-1">
              <div
                className="h-5 rounded bg-accent"
                style={{ width: row.costUsd > 0 ? `max(${pct}%, 8px)` : "0px" }}
              />
            </div>
            <span className="w-20 shrink-0 text-left font-mono font-semibold tabular-nums text-text">
              {formatUsd(row.costUsd)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Choose a "nice" axis top and step so the horizontal gridlines land on round
// numbers (e.g. $0 / $20 / $40 …) rather than raw fractions of the max.
function niceScale(max: number, ticks = 4): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 0.25 };
  const rawStep = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const niceStep = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { top: Math.ceil(max / niceStep) * niceStep, step: niceStep };
}

/** Hand-rolled column chart — one column per calendar day of the selected
 *  month. The caller owns calendar semantics: it passes the full, already
 *  zero-filled day list (and, for the current month, stops at today), so this
 *  only maps cost → height. The tallest column sets the scale; hovering a
 *  column reveals its exact USD. Deliberately no chart library. */
export function SpendByDayChart({ days }: { days: SpendByDay[] }) {
  const max = days.reduce((m, d) => Math.max(m, d.costUsd), 0);
  const { top, step } = niceScale(max);
  // Gridline / axis values, top row first so flex order reads high → low.
  // Index-based so the bottom tick is exactly 0 (no floating-point residual).
  const nTicks = Math.round(top / step);
  const ticks = Array.from({ length: nTicks + 1 }, (_, i) => (nTicks - i) * step);
  const CHART_H = 240;

  return (
    <div className="flex gap-3">
      {/* Y-axis labels, one per gridline, vertically aligned to the plot. */}
      <div
        className="flex flex-col justify-between text-right font-mono text-[12px] tabular-nums text-text-muted"
        style={{ height: CHART_H }}
      >
        {ticks.map((t) => (
          <span key={t} className="leading-none">
            {formatAxisUsd(t, step)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height: CHART_H }}>
          {/* Horizontal gridlines, evenly spaced behind the bars. */}
          <div className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((t) => (
              <div key={t} className="border-t border-border-hairline" />
            ))}
          </div>
          {/* Bars, anchored to the baseline and scaled against the nice top.
              The bar is centred in its flex-1 slot at ~58% width so the plot
              reads light; nonzero days get a 3px floor so they stay legible. */}
          <div className="absolute inset-0 flex items-end gap-1">
            {days.map((d) => {
              const dayNum = Number(d.day.slice(8, 10));
              const pct = top > 0 ? (d.costUsd / top) * 100 : 0;
              return (
                <div
                  key={d.day}
                  title={`${d.day}: ${formatUsd(d.costUsd)}`}
                  className="group flex h-full min-w-0 flex-1 items-end justify-center"
                >
                  <div
                    className="w-[58%] rounded-t-[2px] bg-accent group-hover:bg-accent-hover"
                    style={{
                      height: d.costUsd > 0 ? `max(${pct}%, 3px)` : "0px",
                    }}
                  />
                  {/* Hover shows the exact amount via title; this backs it for
                      screen readers. */}
                  <span className="sr-only">
                    Day {dayNum}: {formatUsd(d.costUsd)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-3 flex gap-1 font-mono text-[10px] tabular-nums text-text-muted">
          {days.map((d) => {
            const dayNum = Number(d.day.slice(8, 10));
            return (
              <span key={d.day} className="min-w-0 flex-1 text-center">
                {dayNum % 2 === 1 ? dayNum : ""}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SessionStats({ session }: { session: SessionRuntime }) {
  const stats: [string, string][] = [
    ["API calls", String(session.calls)],
    ["Model time", formatDurationMs(session.totalDurationMs)],
    [
      "Tokens in / out",
      `${formatTokens(session.inputTokens + session.cacheReadTokens + session.cacheCreationTokens)} / ${formatTokens(session.outputTokens)}`,
    ],
    ["Cost", formatUsd(session.costUsd)],
  ];
  return (
    <dl className="space-y-1">
      {stats.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-2">
          <dt className="text-text-muted">{label}</dt>
          <dd className="font-mono tabular-nums text-text-secondary">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RecentCallsTable({ rows }: { rows: CallContext[] }) {
  return (
    <table className="w-full border-collapse tabular-nums">
      <thead>
        <tr className="text-[10px] uppercase tracking-wide text-text-muted">
          <th className="py-1 text-left font-medium">Time</th>
          <th className="py-1 text-right font-medium">Context</th>
          <th className="py-1 text-right font-medium">Took</th>
          <th className="py-1 text-right font-medium">Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((call) => (
          <tr key={call.requestId} className="border-t border-border-light">
            <td
              className="py-1 pr-2 font-mono text-text-muted"
              title={`${call.model}\n${call.at}`}
            >
              {new Date(call.at).toLocaleTimeString()}
            </td>
            <td className="py-1 pl-2 text-right font-mono">
              {formatTokens(call.contextTokens)}
            </td>
            <td className="py-1 pl-2 text-right font-mono">
              {formatDurationMs(call.durationMs)}
            </td>
            <td className="py-1 pl-2 text-right font-mono">
              {formatUsd(call.costUsd)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
