import type { Db } from "db";
import { and, desc, eq, slackOwnedThreads, sql } from "db";

export interface SlackOwnedThread {
  channelId: string;
  threadTs: string;
  teamId: string;
  agentId: string;
  sessionId: string;
  firstLine: string;
  deliveredUpTo: string;
  createdAt: Date;
}

export type NewSlackOwnedThread = Omit<
  SlackOwnedThread,
  "createdAt" | "deliveredUpTo"
>;

export interface SlackOwnedThreads {
  own(thread: NewSlackOwnedThread): Promise<void>;
  find(channelId: string, threadTs: string): Promise<SlackOwnedThread | null>;
  listForSession(
    agentId: string,
    sessionId: string,
  ): Promise<SlackOwnedThread[]>;
  markDelivered(
    channelId: string,
    threadTs: string,
    upTo: string,
  ): Promise<void>;
  leave(
    agentId: string,
    sessionId: string,
    channelId: string,
    threadTs: string,
  ): Promise<boolean>;
  forgetSession(agentId: string, sessionId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
  forgetAgent(agentId: string): Promise<void>;
}

/** UNIT_BOUNDARY_DESCRIPTION: Keeps which Session owns which Slack thread.
 *  A thread the Agent starts is owned from its own post onward, so its
 *  delivery boundary begins there: nothing before it is a reply. The boundary
 *  only moves forward, whatever order turns finish in. */
export function createSlackOwnedThreadsRepository(db: Db): SlackOwnedThreads {
  return {
    async own(thread) {
      await db
        .insert(slackOwnedThreads)
        .values({ ...thread, deliveredUpTo: thread.threadTs })
        .onConflictDoUpdate({
          target: [slackOwnedThreads.channelId, slackOwnedThreads.threadTs],
          set: {
            agentId: thread.agentId,
            sessionId: thread.sessionId,
            teamId: thread.teamId,
            firstLine: thread.firstLine,
            deliveredUpTo: thread.threadTs,
          },
        });
    },
    async find(channelId, threadTs) {
      const [row] = await db
        .select()
        .from(slackOwnedThreads)
        .where(
          and(
            eq(slackOwnedThreads.channelId, channelId),
            eq(slackOwnedThreads.threadTs, threadTs),
          ),
        );
      return row ?? null;
    },
    async listForSession(agentId, sessionId) {
      return db
        .select()
        .from(slackOwnedThreads)
        .where(
          and(
            eq(slackOwnedThreads.agentId, agentId),
            eq(slackOwnedThreads.sessionId, sessionId),
          ),
        )
        .orderBy(desc(slackOwnedThreads.createdAt));
    },
    async markDelivered(channelId, threadTs, upTo) {
      await db
        .update(slackOwnedThreads)
        .set({ deliveredUpTo: upTo })
        .where(
          and(
            eq(slackOwnedThreads.channelId, channelId),
            eq(slackOwnedThreads.threadTs, threadTs),
            sql`${slackOwnedThreads.deliveredUpTo}::numeric < ${upTo}::numeric`,
          ),
        );
    },
    async leave(agentId, sessionId, channelId, threadTs) {
      const removed = await db
        .delete(slackOwnedThreads)
        .where(
          and(
            eq(slackOwnedThreads.agentId, agentId),
            eq(slackOwnedThreads.sessionId, sessionId),
            eq(slackOwnedThreads.channelId, channelId),
            eq(slackOwnedThreads.threadTs, threadTs),
          ),
        )
        .returning({ threadTs: slackOwnedThreads.threadTs });
      return removed.length > 0;
    },
    async forgetSession(agentId, sessionId) {
      await db
        .delete(slackOwnedThreads)
        .where(
          and(
            eq(slackOwnedThreads.agentId, agentId),
            eq(slackOwnedThreads.sessionId, sessionId),
          ),
        );
    },
    async listAgentIds() {
      const rows = await db
        .selectDistinct({ agentId: slackOwnedThreads.agentId })
        .from(slackOwnedThreads);
      return rows.map((row) => row.agentId);
    },
    async forgetAgent(agentId) {
      await db
        .delete(slackOwnedThreads)
        .where(eq(slackOwnedThreads.agentId, agentId));
    },
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: The same record held in memory, for a worker
 *  with no database and for tests. */
export function createMemorySlackOwnedThreads(): SlackOwnedThreads {
  const rows = new Map<string, SlackOwnedThread>();
  const key = (channelId: string, threadTs: string) =>
    `${channelId} ${threadTs}`;
  const later = (a: string, b: string) => Number(a) < Number(b);
  return {
    async own(thread) {
      rows.set(key(thread.channelId, thread.threadTs), {
        ...thread,
        deliveredUpTo: thread.threadTs,
        createdAt: new Date(),
      });
    },
    async find(channelId, threadTs) {
      return rows.get(key(channelId, threadTs)) ?? null;
    },
    async listForSession(agentId, sessionId) {
      return [...rows.values()]
        .filter((r) => r.agentId === agentId && r.sessionId === sessionId)
        .reverse();
    },
    async markDelivered(channelId, threadTs, upTo) {
      const row = rows.get(key(channelId, threadTs));
      if (row && later(row.deliveredUpTo, upTo)) row.deliveredUpTo = upTo;
    },
    async leave(agentId, sessionId, channelId, threadTs) {
      const row = rows.get(key(channelId, threadTs));
      if (!row || row.agentId !== agentId || row.sessionId !== sessionId)
        return false;
      rows.delete(key(channelId, threadTs));
      return true;
    },
    async forgetSession(agentId, sessionId) {
      for (const [k, r] of rows)
        if (r.agentId === agentId && r.sessionId === sessionId) rows.delete(k);
    },
    async listAgentIds() {
      return [...new Set([...rows.values()].map((r) => r.agentId))];
    },
    async forgetAgent(agentId) {
      for (const [k, r] of rows) if (r.agentId === agentId) rows.delete(k);
    },
  };
}
