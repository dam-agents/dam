import type { SpendSessions } from "api-server-api";
import { foldSessions } from "../domain/sessions.js";
import type { SpendLedger } from "../infrastructure/spend-ledger.js";

export interface SpawnedSubAgents {
  spawnSessions(agentId: string): Promise<ReadonlyMap<string, string | null>>;
}

export async function readSessionSpend(
  deps: { ledger: SpendLedger; subAgents: SpawnedSubAgents },
  query: {
    ownerSub: string;
    agentId: string;
    from: string;
    to: string;
    sessionIds?: readonly string[];
    limit: number;
  },
): Promise<SpendSessions> {
  const { ownerSub, agentId, from, to, sessionIds, limit } = query;
  const [own, spawnSessions] = await Promise.all([
    deps.ledger.sessionRows({
      ownerSub,
      callingAgentIds: [agentId],
      ...(sessionIds && { sessionIds }),
      withSessionOnly: true,
      from,
      to,
    }),
    deps.subAgents.spawnSessions(agentId),
  ]);
  const wanted = sessionIds ? new Set(sessionIds) : null;
  const subAgentIds = [...spawnSessions]
    .filter(([, session]) => session && (!wanted || wanted.has(session)))
    .map(([id]) => id);
  const subAgents = await deps.ledger.sessionRows({
    ownerSub,
    callingAgentIds: subAgentIds,
    withSessionOnly: false,
    from,
    to,
  });
  return foldSessions({
    own,
    subAgents,
    spawnSessions,
    ...(sessionIds && { sessionIds }),
    limit,
  });
}
