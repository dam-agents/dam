import type {
  CallContext,
  SessionRuntime,
  TokenSpendByModel,
} from "api-server-api";

import { useTelemetryOverview } from "../api/queries.js";
import { formatDurationMs, formatTokens, formatUsd } from "../lib/format.js";

interface Props {
  agentId: string | null;
  sessionId: string | null;
}

/** Right-sidebar telemetry tab: last-24h token spend per model, current
 *  session totals, and the most recent LLM calls for the selected agent. */
export function TelemetryPanel({ agentId, sessionId }: Props) {
  const { data, isPending, isError } = useTelemetryOverview(agentId, {
    limit: 25,
  });

  if (!agentId)
    return <PanelNotice>Select an agent to see telemetry</PanelNotice>;
  if (isError)
    return <PanelNotice>Telemetry is unavailable right now</PanelNotice>;
  if (isPending) return <PanelNotice>Loading telemetry…</PanelNotice>;
  if (data.tokenSpendByModel.length === 0)
    return <PanelNotice>No LLM calls in the last 24 hours</PanelNotice>;

  const session =
    data.runtimeBySession.find((s) => s.sessionId === sessionId) ?? null;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 text-[12px]">
      <SectionHeading>Spend by model · 24h</SectionHeading>
      <ModelSpendTable rows={data.tokenSpendByModel} />
      {session && (
        <>
          <SectionHeading>This session</SectionHeading>
          <SessionStats session={session} />
        </>
      )}
      <SectionHeading>Recent calls</SectionHeading>
      <RecentCallsTable rows={data.contextPerCall} />
    </div>
  );
}

function PanelNotice({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-5 text-[12px] text-text-muted">{children}</p>;
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
