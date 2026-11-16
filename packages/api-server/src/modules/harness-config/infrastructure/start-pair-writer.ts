import { agents as agentsTable, and, eq, isNull, type Db } from "db";
import type { SessionPair } from "api-server-api";
import type { SubPseudonymizer } from "../../../core/sub-pseudonymizer.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a new Agent's row is written by the
 * agent-created saga, which can run after the create returns, so the chat
 * default its create names inserts the row when it is not there yet; the
 * saga's upsert keeps the pair. False when the Agent already holds a chat
 * default.
 */
export function createStartPairWriter(
  db: Db,
  pseudo: SubPseudonymizer,
  owner: string,
): (agentId: string, pair: SessionPair) => Promise<boolean> {
  return async (agentId, pair) => {
    const ownerSub = pseudo.hashSub(owner);
    const written = await db
      .insert(agentsTable)
      .values({ id: agentId, ownerSub, sessionPair: pair })
      .onConflictDoUpdate({
        target: agentsTable.id,
        set: { sessionPair: pair, defaultModelNote: null },
        setWhere: and(
          eq(agentsTable.ownerSub, ownerSub),
          isNull(agentsTable.sessionProfile),
          isNull(agentsTable.sessionPair),
        ),
      })
      .returning({ id: agentsTable.id });
    return written.length > 0;
  };
}
