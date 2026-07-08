import { TRPCError } from "@trpc/server";
import type {
  CallContext,
  SessionRuntime,
  TelemetryQuery,
  TelemetryService,
  TokenSpendByModel,
} from "api-server-api";

/** Port: the raw ClickHouse read surface. Takes an already-resolved,
 *  ownership-checked agent-id allowlist — it does no scoping of its own. */
export interface TelemetryReader {
  tokenSpendByModel(
    agentIds: readonly string[],
    hours: number,
  ): Promise<TokenSpendByModel[]>;
  runtimeBySession(
    agentIds: readonly string[],
    hours: number,
  ): Promise<SessionRuntime[]>;
  contextPerCall(
    agentIds: readonly string[],
    hours: number,
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

export function createTelemetryService(deps: {
  reader: TelemetryReader;
  /** The caller's owned agent IDs, already narrowed for API-key binding. */
  listOwnedAgentIds: () => Promise<readonly string[]>;
}): TelemetryService {
  return {
    async overview(query: TelemetryQuery) {
      const ids = await ownedScope(deps.listOwnedAgentIds, query.agentId);
      if (ids.length === 0) {
        return {
          tokenSpendByModel: [],
          runtimeBySession: [],
          contextPerCall: [],
        };
      }
      const [tokenSpendByModel, runtimeBySession, contextPerCall] =
        await Promise.all([
          deps.reader.tokenSpendByModel(ids, query.sinceHours),
          deps.reader.runtimeBySession(ids, query.sinceHours),
          deps.reader.contextPerCall(ids, query.sinceHours, query.limit),
        ]);
      return { tokenSpendByModel, runtimeBySession, contextPerCall };
    },
  };
}

/** Wired when the telemetry backend (ClickStack) is disabled — every read
 *  fails loud rather than masquerading as "no data yet". */
export function createDisabledTelemetryService(): TelemetryService {
  return {
    overview: async () => {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Agent telemetry backend is not enabled on this deployment.",
      });
    },
  };
}
