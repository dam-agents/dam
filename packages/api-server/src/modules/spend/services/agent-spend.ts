import type {
  AgentSpend,
  AgentSpendQuery,
  SpendCallCost,
} from "api-server-api";
import {
  countSessions,
  foldAgentTotals,
  foldSubAgents,
  type AgentLedgerRow,
} from "../domain/agent-spend.js";
import { readRangeOf } from "../domain/read-window.js";
import type { SpendLedger } from "../infrastructure/spend-ledger.js";
import { readSessionSpend, type SpawnedSubAgents } from "./session-spend.js";
import type { AgentOwners } from "./spend-ingest.js";
import type { AgentPayers } from "./spend-service.js";

export interface AgentSpendReader {
  read(query: AgentSpendQuery): Promise<AgentSpend>;
  callCosts(
    agentId: string,
    routerCallIds: readonly string[],
  ): Promise<SpendCallCost[]>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an agent's own measured spend, pinned to that
 * agent by the caller: a root driver reads every call it pays for, its
 * sub-agents' too, and a sub-agent reads the calls it made. A session narrows
 * it to that session's own calls and the sub-agents spawned from it.
 */
export function createAgentSpend(deps: {
  ledger: SpendLedger;
  payers: AgentPayers;
  owners: AgentOwners;
  subAgents: SpawnedSubAgents;
  meteringStart(): Promise<Date>;
}): AgentSpendReader {
  return {
    async callCosts(agentId, routerCallIds) {
      if (routerCallIds.length === 0) return [];
      const ownerSub = await deps.owners.ownerOf(
        await deps.payers.payerOf(agentId),
      );
      return ownerSub ? deps.ledger.callCosts({ ownerSub, routerCallIds }) : [];
    },

    async read(query) {
      const { agentId, from, to, sessionId } = query;
      const [payer, startedAt] = await Promise.all([
        deps.payers.payerOf(agentId),
        deps.meteringStart(),
      ]);
      const scope = payer === agentId ? "payer" : "caller";
      const ownerSub = await deps.owners.ownerOf(payer);
      const view = (rows: readonly AgentLedgerRow[]): AgentSpend => ({
        measuredSince: startedAt.toISOString(),
        scope,
        ...foldAgentTotals(rows),
        sessionCount: countSessions(rows, agentId),
      });
      if (!ownerSub) return view([]);

      const read = query.at
        ? readRangeOf(query.at, new Date(), startedAt)
        : { from, to, at: undefined, window: undefined };
      const range = {
        ownerSub,
        from: read.from,
        to: read.to,
        ...(read.at && { at: read.at }),
      };
      const needsTree =
        sessionId !== undefined ||
        (scope === "caller" && query.subAgentLimit !== undefined);
      const spawned = needsTree
        ? await deps.subAgents.spawnSessions(agentId)
        : new Map<string, string | null>();
      const below = [...spawned]
        .filter(
          ([, spawnedIn]) => sessionId === undefined || spawnedIn === sessionId,
        )
        .map(([id]) => id);

      const [own, tree] = await Promise.all([
        deps.ledger.agentRows({
          ...range,
          ...(scope === "payer" && sessionId === undefined
            ? { payer: agentId }
            : { callingAgentIds: [agentId] }),
          ...(sessionId !== undefined && { sessionId }),
        }),
        needsTree
          ? deps.ledger.agentRows({ ...range, callingAgentIds: below })
          : Promise.resolve([]),
      ]);
      const counted = sessionId === undefined ? own : [...own, ...tree];
      const subAgentRows =
        scope === "payer" && sessionId === undefined
          ? own.filter(
              (row) => row.callingAgentId && row.callingAgentId !== agentId,
            )
          : tree;

      return {
        ...view(counted),
        ...(query.sessionLimit !== undefined && {
          sessions: await readSessionSpend(deps, {
            ...range,
            agentId,
            ...(sessionId !== undefined && { sessionIds: [sessionId] }),
            limit: query.sessionLimit,
          }),
        }),
        ...(query.subAgentLimit !== undefined && {
          subAgents: foldSubAgents(subAgentRows, query.subAgentLimit),
        }),
        ...(read.window && { window: read.window }),
      };
    },
  };
}
