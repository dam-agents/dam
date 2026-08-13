import { TRPCError } from "@trpc/server";
import type {
  CallContext,
  SessionRuntime,
  MetricsQuery,
  MetricsService,
  SpendByAgent,
  SpendByDay,
  TokenSpendByModel,
} from "api-server-api";

export interface MetricsWindow {
  hours?: number;
  fromIso?: string;
  toIso?: string;
  sessionId?: string;
}

export interface MetricsReader {
  tokenSpendByModel(
    agentIds: readonly string[],
    window: MetricsWindow,
  ): Promise<TokenSpendByModel[]>;
  spendByAgent(
    agentIds: readonly string[],
    window: MetricsWindow,
  ): Promise<SpendByAgent[]>;
  spendByDay(
    agentIds: readonly string[],
    window: MetricsWindow,
    timeZone: string,
  ): Promise<SpendByDay[]>;
  runtimeBySession(
    agentIds: readonly string[],
    window: MetricsWindow,
  ): Promise<SessionRuntime[]>;
  contextPerCall(
    agentIds: readonly string[],
    window: MetricsWindow,
    limit: number,
  ): Promise<CallContext[]>;
  close(): Promise<void>;
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
}): MetricsService {
  return {
    async overview(query: MetricsQuery) {
      const ids = ownedScope(await deps.listOwnedAgents(), query.agentId);
      if (ids.length === 0) {
        return {
          tokenSpendByModel: [],
          runtimeBySession: [],
          contextPerCall: [],
        };
      }
      const window = { hours: query.sinceHours, sessionId: query.sessionId };
      const [tokenSpendByModel, runtimeBySession, contextPerCall] =
        await Promise.all([
          deps.reader.tokenSpendByModel(ids, window),
          deps.reader.runtimeBySession(ids, window),
          deps.reader.contextPerCall(ids, window, query.limit),
        ]);
      return { tokenSpendByModel, runtimeBySession, contextPerCall };
    },

    async spendBreakdown(query) {
      const owned = await deps.listOwnedAgents();
      const ids = ownedScope(owned, query.agentId);
      if (ids.length === 0) return { byModel: [], byAgent: [], byDay: [] };
      const window = { fromIso: query.from, toIso: query.to };
      const [byModel, byAgent, byDay] = await Promise.all([
        deps.reader.tokenSpendByModel(ids, window),
        deps.reader.spendByAgent(ids, window),
        deps.reader.spendByDay(ids, window, query.timeZone),
      ]);
      const liveName = new Map(
        owned.flatMap((a) =>
          a.name === null ? [] : [[a.id, a.name] as const],
        ),
      );
      return {
        byModel,
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
