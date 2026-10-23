import {
  AGENT_TELEMETRY_DEFAULT_DAYS,
  formatSpendAmount,
  type AgentSpend,
  type AgentSpendQuery,
  type agentMetricsInputSchema,
  type CallContext,
  type SpendAmount,
  type SpendCallCost,
  type SpendReadWindow,
  type SpendSessionRow,
  type SubAgentSpendRow,
} from "api-server-api";
import type { z } from "zod";
import type {
  MetricsReader,
  MetricsWindow,
  TelemetryEvent,
  TraceSpan,
} from "./metrics-service.js";

export type AgentMetricsGranularity = z.output<
  typeof agentMetricsInputSchema
>["granularity"];

export interface AgentTelemetryQuery {
  days: number;
  limit: number;
  sessionId?: string;
}

export interface AgentMetricsQuery {
  days?: number;
  hours?: number;
  limit: number;
  sessionId?: string;
  granularity: AgentMetricsGranularity;
}

export interface AgentSpendPort {
  read(query: AgentSpendQuery): Promise<AgentSpend>;
  callCosts(
    agentId: string,
    routerCallIds: readonly string[],
  ): Promise<SpendCallCost[]>;
}

interface Measured {
  available: true;
  windowDays?: number;
  windowHours?: number;
  sessionId?: string;
}

export interface Unavailable {
  available: false;
  reason: string;
}

type Priced<T extends SpendAmount> = T & { amount: string };

type MeasuredCall = Omit<CallContext, "costUsd" | "routerCallId"> & {
  cost: (Priced<SpendAmount> & { estimated: boolean }) | null;
};

export type AgentMetricsResult =
  | (Measured & {
      granularity: AgentMetricsGranularity;
      measuredSince: string;
      window: { from: string; to: string };
      readWindow?: SpendReadWindow;
      totals: Priced<AgentSpend["totals"][number]>[];
      modelTimeMs: number;
      sessionCount: number;
      byModel: Priced<AgentSpend["byModel"][number]>[];
      totalsCover: string;
      sessions?: (Omit<SpendSessionRow, "amounts" | "subAgentAmounts"> & {
        amounts: Priced<SpendAmount>[];
        subAgentAmounts: Priced<SpendAmount>[];
      })[];
      calls?: MeasuredCall[];
      subAgents?: (Omit<SubAgentSpendRow, "agentId" | "amounts"> & {
        subAgentId: string;
        amounts: Priced<SpendAmount>[];
      })[];
      truncated?: boolean;
    })
  | Unavailable;

export type AgentLogsResult =
  (Measured & { logs: TelemetryEvent[]; truncated: boolean }) | Unavailable;

export type AgentSpansResult =
  | (Measured & { spans: TraceSpan[]; truncated: boolean })
  | (Measured & { spans: never[]; sessionUnresolved: true; reason: string })
  | Unavailable;

export interface AgentTelemetryService {
  metrics(
    agentId: string,
    query: AgentMetricsQuery,
  ): Promise<AgentMetricsResult>;
  logs(agentId: string, query: AgentTelemetryQuery): Promise<AgentLogsResult>;
  spans(agentId: string, query: AgentTelemetryQuery): Promise<AgentSpansResult>;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const ROWS_CAPPED =
  "The rows below are only the most recent up to limit — truncated says whether more exist, so do not expect the rows to sum to the totals.";

const SUB_AGENT_ROWS =
  "Each sub-agent row is that sub-agent's own calls: a sub-agent that spawned its own has them as rows of their own.";

const CALL_ROWS =
  "The call rows come from this agent's own telemetry, each with the measured cost of its call when the gateway recorded one; the totals are the measured spend.";

const BOTH_WINDOWS = "Give days or hours, not both.";

function windowText(
  window: { from: string; to: string },
  read: SpendReadWindow | undefined,
  hours: number | undefined,
): string {
  if (read?.granularity === "hour")
    return `the last ${hours === 1 ? "hour" : `${hours} hours`}, ${read.fromAt} to ${read.toAt}`;
  const days = `UTC days ${window.from} to ${window.to}`;
  return read
    ? `${days} (whole days: per-call rows that count hours are kept for 30 days)`
    : days;
}

function totalsCoverFor(
  query: AgentMetricsQuery,
  spend: AgentSpend,
  window: { from: string; to: string },
): string {
  const days = windowText(window, spend.window, query.hours);
  const whose =
    spend.scope === "payer"
      ? `Measured spend of this agent and its sub-agents, ${days}.`
      : `Measured spend of this sub-agent's own calls, ${days}.`;
  const session =
    query.sessionId === undefined
      ? []
      : [
          `Narrowed to session ${query.sessionId} and the sub-agents spawned from it.`,
        ];
  const before = `Spend before ${spend.measuredSince} is not measured.`;
  const rows =
    query.granularity === "summary"
      ? ["This granularity returns no rows."]
      : [
          ROWS_CAPPED,
          ...(query.granularity === "subagent" ? [SUB_AGENT_ROWS] : []),
          ...(query.granularity === "call" ? [CALL_ROWS] : []),
        ];
  return [whose, ...session, before, ...rows].join(" ");
}

function utcDaysOf(
  days: number,
  now = Date.now(),
): { from: string; to: string } {
  const day = (at: number) => new Date(at).toISOString().slice(0, 10);
  return { from: day(now - (days - 1) * DAY_MS), to: day(now) };
}

function priced<T extends SpendAmount>(amount: T): Priced<T> {
  return {
    ...amount,
    amount: formatSpendAmount(amount.costMicros, amount.unit),
  };
}

function windowFor(
  query: Pick<AgentMetricsQuery, "days" | "hours" | "sessionId">,
): MetricsWindow {
  return {
    hours: query.hours ?? (query.days ?? AGENT_TELEMETRY_DEFAULT_DAYS) * 24,
    ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
  };
}

function page<T>(rows: T[], limit: number): { rows: T[]; truncated: boolean } {
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

function measured(
  query: Pick<AgentMetricsQuery, "days" | "hours" | "sessionId">,
): Measured {
  return {
    available: true,
    ...(query.hours === undefined
      ? { windowDays: query.days ?? AGENT_TELEMETRY_DEFAULT_DAYS }
      : { windowHours: query.hours }),
    ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
  };
}

const NO_BACKEND =
  "The telemetry backend is not enabled on this deployment, so nothing about this agent's runs is measured here.";

const NO_CALL_ROWS =
  "The per-call rows come from agent telemetry, which this deployment does not collect. The summary, session and subagent granularities still answer from the measured spend.";

const unavailable = (reason: string): Unavailable => ({
  available: false,
  reason,
});

/**
 * UNIT_BOUNDARY_DESCRIPTION: what an agent learns about its own runs. The
 * cost figures come from the gateway's measured spend, pinned to the calling
 * agent, and answer on every deployment; the per-call rows, logs and spans
 * come from the telemetry store and need it.
 */
export function createAgentTelemetry(deps: {
  reader: MetricsReader | null;
  spend: AgentSpendPort;
}): AgentTelemetryService {
  return {
    async metrics(agentId, query) {
      if (query.days !== undefined && query.hours !== undefined)
        throw new Error(BOTH_WINDOWS);
      if (query.granularity === "call" && !deps.reader)
        return unavailable(NO_CALL_ROWS);
      const now = Date.now();
      const asked = utcDaysOf(
        query.hours === undefined
          ? (query.days ?? AGENT_TELEMETRY_DEFAULT_DAYS)
          : Math.ceil(query.hours / 24) + 1,
        now,
      );
      const spend = await deps.spend.read({
        agentId,
        ...asked,
        ...(query.hours !== undefined && {
          at: {
            fromAt: new Date(now - query.hours * HOUR_MS).toISOString(),
            toAt: new Date(now).toISOString(),
          },
        }),
        ...(query.sessionId !== undefined && { sessionId: query.sessionId }),
        ...(query.granularity === "session" && {
          sessionLimit: query.limit,
        }),
        ...(query.granularity === "subagent" && {
          subAgentLimit: query.limit,
        }),
      });
      const window = spend.window
        ? {
            from: spend.window.fromAt.slice(0, 10),
            to: new Date(Date.parse(spend.window.toAt) - 1)
              .toISOString()
              .slice(0, 10),
          }
        : asked;
      const base = {
        ...measured(query),
        granularity: query.granularity,
        measuredSince: spend.measuredSince,
        window,
        ...(spend.window && { readWindow: spend.window }),
        totals: spend.totals.map(priced),
        modelTimeMs: spend.modelTimeMs,
        sessionCount: spend.sessionCount,
        byModel: spend.byModel.map(priced),
        totalsCover: totalsCoverFor(query, spend, window),
      };
      if (spend.sessions) {
        return {
          ...base,
          sessions: spend.sessions.rows.map((row) => ({
            ...row,
            amounts: row.amounts.map(priced),
            subAgentAmounts: row.subAgentAmounts.map(priced),
          })),
          truncated: spend.sessions.truncated,
        };
      }
      if (spend.subAgents) {
        return {
          ...base,
          subAgents: spend.subAgents.rows.map(
            ({ agentId: subAgentId, amounts, ...row }) => ({
              subAgentId,
              ...row,
              amounts: amounts.map(priced),
            }),
          ),
          truncated: spend.subAgents.truncated,
        };
      }
      if (query.granularity === "call" && deps.reader) {
        const { rows, truncated } = page(
          await deps.reader.contextPerCall(
            [agentId],
            windowFor(query),
            query.limit + 1,
          ),
          query.limit,
        );
        const costs = new Map(
          (
            await deps.spend.callCosts(
              agentId,
              rows.flatMap((row) =>
                row.routerCallId ? [row.routerCallId] : [],
              ),
            )
          ).map(({ routerCallId, unit, costMicros, estimated }) => [
            routerCallId,
            { ...priced({ unit, costMicros }), estimated },
          ]),
        );
        return {
          ...base,
          calls: rows.map(({ costUsd: _cost, routerCallId, ...call }) => ({
            ...call,
            cost: costs.get(routerCallId) ?? null,
          })),
          truncated,
        };
      }
      return base;
    },

    async logs(agentId, query) {
      if (!deps.reader) return unavailable(NO_BACKEND);
      const { rows, truncated } = page(
        await deps.reader.telemetryEvents(
          [agentId],
          windowFor(query),
          query.limit + 1,
        ),
        query.limit,
      );
      return { ...measured(query), logs: rows, truncated };
    },

    async spans(agentId, query) {
      if (!deps.reader) return unavailable(NO_BACKEND);
      const window = windowFor(query);
      if (
        query.sessionId !== undefined &&
        !(await deps.reader.sessionResolves([agentId], window))
      ) {
        return {
          ...measured(query),
          spans: [],
          sessionUnresolved: true,
          reason: UNRESOLVED_SESSION,
        };
      }
      const { rows, truncated } = page(
        await deps.reader.traceSpans([agentId], window, query.limit + 1),
        query.limit,
      );
      return { ...measured(query), spans: rows, truncated };
    },
  };
}

const UNRESOLVED_SESSION =
  "This session has no LLM-call records in the window, so the trace family that identifies its spans cannot be resolved. No narrowing was applied and no spans are reported — this is not a measurement of zero spans. Retry without sessionId to see the agent's spans across the window.";
