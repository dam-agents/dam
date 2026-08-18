import { randomUUID } from "node:crypto";
import { activityEvents, actorRoles, sql, type Db } from "db";
import type { SubPseudonymizer } from "../../../core/sub-pseudonymizer.js";
import type { ActivityEventRow } from "../domain/types.js";

export function insertActivityEvent(db: Db, pseudo: SubPseudonymizer) {
  return async (row: ActivityEventRow): Promise<void> => {
    const { externalActorId, ownerSub, ...rest } = row;
    await db
      .insert(activityEvents)
      .values({
        id: randomUUID(),
        ...rest,
        actorSub: pseudo.hashSub(row.actorSub),
        payload: {
          ...row.payload,
          ...(externalActorId
            ? { externalActorId: pseudo.hashSub(externalActorId) }
            : {}),
          ...(ownerSub ? { ownerSub: pseudo.hashSub(ownerSub) } : {}),
        },
      })
      .onConflictDoNothing();
  };
}

export function upsertActorRole(db: Db, pseudo: SubPseudonymizer) {
  return async (actorSub: string, isCore: boolean): Promise<void> => {
    await db
      .insert(actorRoles)
      .values({ actorSub: pseudo.hashSub(actorSub), isCore })
      .onConflictDoUpdate({
        target: actorRoles.actorSub,
        set: { isCore, updatedAt: sql`now()` },
        setWhere: sql`${actorRoles.updatedAt} < CURRENT_DATE`,
      });
  };
}
