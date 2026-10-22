import { TRPCError } from "@trpc/server";
import type {
  CallContext,
  SessionRuntime,
  MetricsQuery,
  MetricsService,
  SpendByAgent,
  SpendByDay,
  TokenSpendByModel,
  TokenSpendByProvider,
} from "api-server-api";

import type { SessionSpend } from "../domain/spend-by-session-type.js";
import type { SessionTypeSpend } from "./session-type-spend.js";

export interface MetricsWindow {
  hours?: number;
  fromIso?: string;
  toIso?: string;
  sessionId?: string;
}

export type { SessionSpend };

export interface TelemetryEvent {
  at: string;
  body: string;
  severity: string;
  sessionId: string;
  traceId: string;
  attributes: Record<string, string>;
}

export interface TraceSpan {
  at: string;
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  kind: string;
  serviceName: string;
  durationMs: number;
  statusCode: string;
  statusMessage: string;
  attributes: Record<string, string>;
}

export interface MetricsReader {
  tokenSpendByModel(
    agentIds: readonly string[],
    window: MetricsWindow,
  ): Promise<TokenSpendByModel[]>;
  tokenSpendByProvider(
    agentIds: readonly string[],
    window: MetricsWindow,
  ): Promise<TokenSpendByProvider[]>;
  spendByAgent(
    agentIds: readonly string[],
    window: MetricsWindow,
  ): Promise<SpendByAgent[]>;
  spendByDay(
    agentIds: readonly string[],
    window: MetricsWindow,
    timeZone: string,
  ): Promise<SpendByDay[]>;
  spendBySession(
    agentIds: readonly string[],
    window: MetricsWindow,
  ): Promise<SessionSpend[]>;
  runtimeBySession(
    agentIds: readonly string[],
    window: MetricsWindow,
  ): Promise<SessionRuntime[]>;
  contextPerCall(
    agentIds: readonly string[],
    window: MetricsWindow,
    limit: number,
  ): Promise<CallContext[]>;
  telemetryEvents(
    agentIds: readonly string[],
    window: MetricsWindow,
    limit: number,
  ): Promise<TelemetryEvent[]>;
  sessionResolves(
    agentIds: readonly string[],
    window: MetricsWindow,
  ): Promise<boolean>;
  traceSpans(
    agentIds: readonly string[],
    window: MetricsWindow,
    limit: number,
  ): Promise<TraceSpan[]>;
}

export interface OwnedAgent {
  id: string;
  name: string | null;
}

function ownedScope(
  owned: readonly OwnedAgent[],
  agentId: string | undefined,
): string[] {
  const ids = owned.map((a) => a.id);
  if (!agentId) return ids;
  return ids.includes(agentId) ? [agentId] : [];
}

export function createMetricsService(deps: {
  reader: MetricsReader;
  listOwnedAgents: () => Promise<readonly OwnedAgent[]>;
  isInvocationTargetName: (name: string) => boolean;
  sessionTypeSpend: SessionTypeSpend;
  connectionNames?: () => Promise<ReadonlyMap<string, string>>;
}): MetricsService {
  /**
   * UNIT_BOUNDARY_DESCRIPTION: a provider row is labelled from the
   * platform's registry, never from telemetry; a deleted Connection keeps
   * its alias alone.
   */
  const labelled = async (
    rows: TokenSpendByProvider[],
  ): Promise<TokenSpendByProvider[]> => {
    if (rows.length === 0) return rows;
    const names = (await deps.connectionNames?.()) ?? new Map<string, string>();
    return rows.map((r) => ({
      ...r,
      connectionName: names.get(r.connectionId) ?? null,
    }));
  };
  return {
    async overview(query: MetricsQuery) {
      const ids = ownedScope(await deps.listOwnedAgents(), query.agentId);
      if (ids.length === 0) {
        return {
          tokenSpendByModel: [],
          tokenSpendByProvider: [],
          runtimeBySession: [],
          contextPerCall: [],
        };
      }
      const window = { hours: query.sinceHours, sessionId: query.sessionId };
      const [
        tokenSpendByModel,
        tokenSpendByProvider,
        runtimeBySession,
        contextPerCall,
      ] = await Promise.all([
        deps.reader.tokenSpendByModel(ids, window),
        deps.reader.tokenSpendByProvider(ids, window).then(labelled),
        deps.reader.runtimeBySession(ids, window),
        deps.reader.contextPerCall(ids, window, query.limit),
      ]);
      return {
        tokenSpendByModel,
        tokenSpendByProvider,
        runtimeBySession,
        contextPerCall,
      };
    },

    async spendBreakdown(query) {
      const owned = await deps.listOwnedAgents();
      const ids = ownedScope(owned, query.agentId);
      if (ids.length === 0)
        return {
          byModel: [],
          byProvider: [],
          byAgent: [],
          byDay: [],
          bySessionType: [],
        };
      const window = { fromIso: query.from, toIso: query.to };
      const [byModel, byProvider, byAgent, byDay, bySessionType] =
        await Promise.all([
          deps.reader.tokenSpendByModel(ids, window),
          deps.reader.tokenSpendByProvider(ids, window).then(labelled),
          deps.reader.spendByAgent(ids, window),
          deps.reader.spendByDay(ids, window, query.timeZone),
          deps.sessionTypeSpend.breakdown(ids, window),
        ]);
      const liveName = new Map(
        owned.flatMap((a) =>
          a.name === null ? [] : [[a.id, a.name] as const],
        ),
      );
      return {
        byModel,
        byProvider,
        byAgent: byAgent
          .map((r) => ({
            ...r,
            agentName: liveName.get(r.agentId) ?? r.agentName,
          }))
          .filter(
            (r) =>
              liveName.has(r.agentId) ||
              !deps.isInvocationTargetName(r.agentName),
          ),
        byDay,
        bySessionType,
      };
    },
  };
}

export function createDisabledMetricsService(): MetricsService {
  const fail = async (): Promise<never> => {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Agent metrics backend is not enabled on this deployment.",
    });
  };
  return { overview: fail, spendBreakdown: fail };
}
