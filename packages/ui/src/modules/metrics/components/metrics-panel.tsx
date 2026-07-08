import type {
  CallContext,
  SessionRuntime,
  TokenSpendByModel,
} from "api-server-api";
import { useState } from "react";

import { useMetricsOverview } from "../api/queries.js";
import { formatDurationMs, formatTokens, formatUsd } from "../lib/format.js";

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

  const session = sessionScope ? (data.runtimeBySession[0] ?? null) : null;

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

function ModelSpendTable({ rows }: { rows: TokenSpendByModel[] }) {
  return (
    <table className="w-full border-collapse tabular-nums">
      <thead>
        <tr className="text-[10px] uppercase tracking-wide text-text-muted">
          <th className="py-1 text-left font-medium">Model</th>
          <th className="py-1 text-right font-medium">In</th>
          <th className="py-1 text-right font-medium">Out</th>
          <th className="py-1 text-right font-medium">Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.model} className="border-t border-border-light">
            <td
              className="max-w-0 w-full truncate py-1 pr-2 font-mono text-text-secondary"
              title={row.model}
            >
              {row.model}
            </td>
            {/* Cache reads dominate agent traffic; fold them into "in" so the
                column reflects what actually entered the context. */}
            <td className="py-1 pl-2 text-right font-mono">
              {formatTokens(
                row.inputTokens + row.cacheReadTokens + row.cacheCreationTokens,
              )}
            </td>
            <td className="py-1 pl-2 text-right font-mono">
              {formatTokens(row.outputTokens)}
            </td>
            <td className="py-1 pl-2 text-right font-mono font-medium">
              {formatUsd(row.costUsd)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
