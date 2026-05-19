import type { Db } from "db";
import { allowedUsers, eq, and, inArray } from "db";

export function listAllowedUsersByOwner(db: Db, owner: string) {
  return async (): Promise<Map<string, string[]>> => {
    const condition = owner ? eq(allowedUsers.owner, owner) : undefined;
    const rows = await db.select().from(allowedUsers).where(condition);
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const list = map.get(row.agentId) ?? [];
      list.push(row.keycloakSub);
      map.set(row.agentId, list);
    }
    return map;
  };
}

export function listAllowedUsersByAgent(db: Db, owner: string) {
  return async (agentId: string): Promise<string[]> => {
    const condition = owner
      ? and(eq(allowedUsers.agentId, agentId), eq(allowedUsers.owner, owner))
      : eq(allowedUsers.agentId, agentId);
    const rows = await db.select().from(allowedUsers).where(condition);
    return rows.map((r) => r.keycloakSub);
  };
}

export function setAllowedUsers(db: Db, owner: string) {
  return async (agentId: string, subs: string[]): Promise<void> => {
    await db
      .delete(allowedUsers)
      .where(
        and(eq(allowedUsers.agentId, agentId), eq(allowedUsers.owner, owner)),
      );
    if (subs.length > 0) {
      await db
        .insert(allowedUsers)
        .values(subs.map((keycloakSub) => ({ agentId, owner, keycloakSub })));
    }
  };
}

export function deleteAllowedUsersByAgentIds(db: Db, owner: string) {
  return async (agentIds: string[]): Promise<void> => {
    if (agentIds.length === 0) return;
    await db
      .delete(allowedUsers)
      .where(
        and(
          inArray(allowedUsers.agentId, agentIds),
          eq(allowedUsers.owner, owner),
        ),
      );
  };
}
