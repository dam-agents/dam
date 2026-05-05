import type { Db } from "db";
import { allowedUsers, eq, and, inArray } from "db";

export function listAllowedUsersByOwner(db: Db, owner: string) {
  return async (): Promise<Map<string, string[]>> => {
    const condition = owner ? eq(allowedUsers.owner, owner) : undefined;
    const rows = await db.select().from(allowedUsers).where(condition);
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const list = map.get(row.instanceId) ?? [];
      list.push(row.keycloakSub);
      map.set(row.instanceId, list);
    }
    return map;
  };
}

export function listAllowedUsersByInstance(db: Db, owner: string) {
  return async (instanceId: string): Promise<string[]> => {
    const condition = owner
      ? and(eq(allowedUsers.instanceId, instanceId), eq(allowedUsers.owner, owner))
      : eq(allowedUsers.instanceId, instanceId);
    const rows = await db.select().from(allowedUsers).where(condition);
    return rows.map((r) => r.keycloakSub);
  };
}

export function setAllowedUsers(db: Db, owner: string) {
  return async (instanceId: string, subs: string[]): Promise<void> => {
    await db.delete(allowedUsers).where(
      and(eq(allowedUsers.instanceId, instanceId), eq(allowedUsers.owner, owner)),
    );
    if (subs.length > 0) {
      await db.insert(allowedUsers).values(
        subs.map((keycloakSub) => ({ instanceId, owner, keycloakSub })),
      );
    }
  };
}

export function deleteAllowedUsersByInstanceIds(db: Db, owner: string) {
  return async (instanceIds: string[]): Promise<void> => {
    if (instanceIds.length === 0) return;
    await db.delete(allowedUsers).where(and(inArray(allowedUsers.instanceId, instanceIds), eq(allowedUsers.owner, owner)));
  };
}
