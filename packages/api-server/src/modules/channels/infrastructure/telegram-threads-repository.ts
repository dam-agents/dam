import type { Db } from "db";
import { telegramThreads, eq, and } from "db";

export function isThreadAuthorized(db: Db) {
  return async (instanceId: string, threadId: string): Promise<boolean> => {
    const rows = await db
      .select()
      .from(telegramThreads)
      .where(
        and(
          eq(telegramThreads.instanceId, instanceId),
          eq(telegramThreads.threadId, threadId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  };
}

export function authorizeThread(db: Db) {
  return async (
    instanceId: string,
    threadId: string,
    authorizedBy: string,
  ): Promise<void> => {
    await db
      .insert(telegramThreads)
      .values({ instanceId, threadId, authorizedBy })
      .onConflictDoUpdate({
        target: [telegramThreads.instanceId, telegramThreads.threadId],
        set: { authorizedBy },
      });
  };
}

export function listAuthorizedThreads(db: Db) {
  return async (instanceId: string): Promise<string[]> => {
    const rows = await db
      .select({ threadId: telegramThreads.threadId })
      .from(telegramThreads)
      .where(eq(telegramThreads.instanceId, instanceId));
    return rows.map((r) => r.threadId);
  };
}

export function revokeThread(db: Db) {
  return async (instanceId: string, threadId: string): Promise<void> => {
    await db
      .delete(telegramThreads)
      .where(
        and(
          eq(telegramThreads.instanceId, instanceId),
          eq(telegramThreads.threadId, threadId),
        ),
      );
  };
}

export function deleteThreadsByInstance(db: Db) {
  return async (instanceId: string): Promise<void> => {
    await db
      .delete(telegramThreads)
      .where(eq(telegramThreads.instanceId, instanceId));
  };
}
