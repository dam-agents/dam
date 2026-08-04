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

/** Row filters beyond ownership, independent and composable: an optional
 *  lookback window, an optional absolute [fromIso, toIso) range, and an
 *  optional exact session. All absent = all rows. */
export interface MetricsWindow {
  hours?: number;
  fromIso?: string;
  toIso?: string;
  sessionId?: string;
}

/** Port: the raw ClickHouse read surface. Takes an already-resolved,
 *  ownership-checked agent-id allowlist — it does no scoping of its own. */
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

/** One entry of the caller's ownership scope: a live agent carries its
 *  current display name; a registry-only (since-deleted) agent carries null. */
export interface OwnedAgent {
  id: string;
  name: string | null;
}

/** Narrow the caller's owned agents to an id allowlist, optionally to one
 *  requested agent. Returns `[]` when the requested agent isn't owned — the
 *  read then yields nothing, which is the ownership guarantee. */
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
  /** The caller's owned agents, already narrowed for API-key binding. */
  listOwnedAgents: () => Promise<readonly OwnedAgent[]>;
  /** Recognizes an Invocation target's minted throwaway name (owned by the
   *  invocations module, injected at composition). */
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
      // Resolve ownership once, then fan the three rollups out over the same
      // allowlist and range. Collapsed from three procedures so a Usage page
      // load does one agent-list + scope resolution rather than three.
      const owned = await deps.listOwnedAgents();
      const ids = ownedScope(owned, query.agentId);
      if (ids.length === 0) return { byModel: [], byAgent: [], byDay: [] };
      const window = { fromIso: query.from, toIso: query.to };
      const [byModel, byAgent, byDay] = await Promise.all([
        deps.reader.tokenSpendByModel(ids, window),
        deps.reader.spendByAgent(ids, window),
        deps.reader.spendByDay(ids, window, query.timeZone),
      ]);
      // The per-agent bar must never read as an Invocation target — a target
      // is not a spend principal. Two read-side guards on top of the write-time
      // attribution:
      //  1. A live agent's bar is labelled from the platform registry, not
      //     from telemetry — so a bucket whose telemetry name was polluted by
      //     child rows (or renamed since) still shows the agent's real name.
      //     Deleted agents keep their last telemetry-known name.
      //  2. A bucket with no live agent whose telemetry name is a minted
      //     target name is an Invocation target — pre-attribution-cutover rows
      //     whose driver is unrecoverable (invocation rows are dropped minutes
      //     after terminal). The row is excluded rather than shown under a
      //     throwaway identity; its spend still counts in byModel/byDay. The
      //     live-agent gate keeps the guard off real agents: a live agent a
      //     user happened to name `invocation-<hex>` keeps its bar.
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

/** Wired when the metrics backend (ClickStack) is disabled — every read
 *  fails loud rather than masquerading as "no data yet". */
export function createDisabledMetricsService(): MetricsService {
  const fail = async (): Promise<never> => {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Agent metrics backend is not enabled on this deployment.",
    });
  };
  return { overview: fail, spendBreakdown: fail };
}
