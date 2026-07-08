import { TRPCError } from "@trpc/server";
import type {
  CallContext,
  SessionRuntime,
  MetricsQuery,
  MetricsService,
  TokenSpendByModel,
} from "api-server-api";

/** Row filters beyond ownership, independent and composable: an optional
 *  lookback window and an optional exact session. Both absent = all rows. */
export interface MetricsWindow {
  hours?: number;
  sessionId?: string;
}

/** Port: the raw ClickHouse read surface. Takes an already-resolved,
 *  ownership-checked agent-id allowlist — it does no scoping of its own. */
export interface MetricsReader {
  tokenSpendByModel(
    agentIds: readonly string[],
    window: MetricsWindow,
  ): Promise<TokenSpendByModel[]>;
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

/** Resolve the caller's owned agent IDs, optionally narrowed to one. Returns
 *  `[]` when the requested agent isn't owned — the read then yields nothing,
 *  which is the ownership guarantee. */
async function ownedScope(
  listOwnedAgentIds: () => Promise<readonly string[]>,
  agentId: string | undefined,
): Promise<string[]> {
  const owned = await listOwnedAgentIds();
  if (!agentId) return [...owned];
  return owned.includes(agentId) ? [agentId] : [];
}

export function createMetricsService(deps: {
  reader: MetricsReader;
  /** The caller's owned agent IDs, already narrowed for API-key binding. */
  listOwnedAgentIds: () => Promise<readonly string[]>;
}): MetricsService {
  return {
    async overview(query: MetricsQuery) {
      const ids = await ownedScope(deps.listOwnedAgentIds, query.agentId);
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
  };
}

/** Wired when the metrics backend (ClickStack) is disabled — every read
 *  fails loud rather than masquerading as "no data yet". */
export function createDisabledMetricsService(): MetricsService {
  return {
    overview: async () => {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Agent metrics backend is not enabled on this deployment.",
      });
    },
  };
}
