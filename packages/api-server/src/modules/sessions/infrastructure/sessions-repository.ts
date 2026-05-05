import type { Db } from "db";
import { sessions, eq, and, desc, sql } from "db";
import { SessionType } from "api-server-api";

export function listSessionsByInstance(db: Db) {
  return async (instanceId: string) => {
    return db
      .select()
      .from(sessions)
      .where(eq(sessions.instanceId, instanceId))
      .orderBy(desc(sessions.createdAt));
  };
}

export function listSessionsByScheduleId(db: Db) {
  return async (scheduleId: string) => {
    return db
      .select()
      .from(sessions)
      .where(eq(sessions.scheduleId, scheduleId))
      .orderBy(desc(sessions.createdAt));
  };
}

export function findActiveByScheduleId(db: Db) {
  return async (scheduleId: string) => {
    const rows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.scheduleId, scheduleId), eq(sessions.scheduleActive, true)))
      .orderBy(desc(sessions.createdAt))
      .limit(1);
    return rows[0] ?? null;
  };
}

export function deactivateByScheduleId(db: Db) {
  return async (scheduleId: string) => {
    await db
      .update(sessions)
      .set({ scheduleActive: false })
      .where(eq(sessions.scheduleId, scheduleId));
  };
}

export function findByInstanceAndThreadTs(db: Db) {
  return async (instanceId: string, threadTs: string) => {
    const rows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.instanceId, instanceId), eq(sessions.threadTs, threadTs)))
      .limit(1);
    return rows[0] ?? null;
  };
}

export function upsertSession(db: Db) {
  return async (
    sessionId: string,
    instanceId: string,
    type: SessionType = SessionType.Regular,
    scheduleId?: string,
    threadTs?: string,
  ) => {
    await db
      .insert(sessions)
      .values({ sessionId, instanceId, type, scheduleId, threadTs })
      .onConflictDoNothing();
  };
}

export function touchSession(db: Db) {
  return async (sessionId: string) => {
    await db
      .update(sessions)
      .set({ updatedAt: sql`now()` })
      .where(eq(sessions.sessionId, sessionId));
  };
}

export function deleteSession(db: Db) {
  return async (sessionId: string, instanceId: string) => {
    await db.delete(sessions).where(and(eq(sessions.sessionId, sessionId), eq(sessions.instanceId, instanceId)));
  };
}
