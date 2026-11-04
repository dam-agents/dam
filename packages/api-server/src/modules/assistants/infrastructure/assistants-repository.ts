import { and, assistants, eq, sql, type Db } from "db";

import type { AssistantRename } from "../domain/types.js";

/** UNIT_BOUNDARY_DESCRIPTION: how far provisioning has got with the owner's assistant: its Agent still has steps to run, or it is initialized, or it was deleted. */
export type AssistantRowState = "creating" | "ready" | "gone";

export interface AssistantRow {
  owner: string;
  incarnation: number;
  agentId: string;
  state: AssistantRowState;
  used: boolean;
  renamed: AssistantRename | null;
  noticeSeen: boolean;
}

export { type AssistantRename } from "../domain/types.js";

export interface AssistantsRepository {
  find(owner: string): Promise<AssistantRow | null>;
  start(owner: string, agentId: string): Promise<boolean>;
  nextIncarnation(
    owner: string,
    fromAgentId: string,
    toAgentId: string,
  ): Promise<boolean>;
  markReady(owner: string, agentId: string): Promise<void>;
  recordRename(
    owner: string,
    agentId: string,
    rename: AssistantRename,
  ): Promise<void>;
  completeRename(owner: string, agentId: string): Promise<void>;
  clearRename(owner: string, agentId: string): Promise<void>;
  markNoticeSeen(owner: string): Promise<void>;
  markUsed(agentId: string): Promise<void>;
  forgetByAgent(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
}

const COLUMNS = {
  owner: assistants.owner,
  incarnation: assistants.incarnation,
  agentId: assistants.agentId,
  state: assistants.state,
  usedAt: assistants.usedAt,
  renamedAgentId: assistants.renamedAgentId,
  renamedFrom: assistants.renamedFrom,
  renamedTo: assistants.renamedTo,
  renamedDoneAt: assistants.renamedDoneAt,
  noticeSeenAt: assistants.noticeSeenAt,
};

type Row = {
  owner: string;
  incarnation: number;
  agentId: string;
  state: string;
  usedAt: Date | null;
  renamedAgentId: string | null;
  renamedFrom: string | null;
  renamedTo: string | null;
  renamedDoneAt: Date | null;
  noticeSeenAt: Date | null;
};

function toRow(row: Row): AssistantRow {
  return {
    owner: row.owner,
    incarnation: row.incarnation,
    agentId: row.agentId,
    state:
      row.state === "ready" || row.state === "gone" ? row.state : "creating",
    used: row.usedAt !== null,
    renamed:
      row.renamedAgentId && row.renamedFrom && row.renamedTo
        ? {
            agentId: row.renamedAgentId,
            from: row.renamedFrom,
            to: row.renamedTo,
            done: row.renamedDoneAt !== null,
          }
        : null,
    noticeSeen: row.noticeSeenAt !== null,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The row per owner that makes the assistant one per
 * owner, and the durable record of provisioning it. Every call is one statement,
 * so nothing holds a pool connection across the Agent's creation, and none of
 * them waits for another: `start` is settled by the primary key, and
 * `nextIncarnation` is a compare-and-set on the Agent id, so one caller moves the
 * owner to the next incarnation and the rest find it already moved.
 */
export function createAssistantsRepository(db: Db): AssistantsRepository {
  return {
    async find(owner) {
      const [row] = await db
        .select(COLUMNS)
        .from(assistants)
        .where(eq(assistants.owner, owner));
      return row ? toRow(row) : null;
    },

    async start(owner, agentId) {
      const inserted = await db
        .insert(assistants)
        .values({ owner, agentId, state: "creating" })
        .onConflictDoNothing()
        .returning({ owner: assistants.owner });
      return inserted.length > 0;
    },

    async nextIncarnation(owner, fromAgentId, toAgentId) {
      const moved = await db
        .update(assistants)
        .set({
          incarnation: sql`${assistants.incarnation} + 1`,
          agentId: toAgentId,
          state: "creating",
          usedAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(assistants.owner, owner), eq(assistants.agentId, fromAgentId)),
        )
        .returning({ owner: assistants.owner });
      return moved.length > 0;
    },

    async markReady(owner, agentId) {
      await db
        .update(assistants)
        .set({ state: "ready", updatedAt: sql`now()` })
        .where(
          and(eq(assistants.owner, owner), eq(assistants.agentId, agentId)),
        );
    },

    async recordRename(owner, agentId, rename) {
      await db
        .update(assistants)
        .set({
          renamedAgentId: rename.agentId,
          renamedFrom: rename.from,
          renamedTo: rename.to,
          renamedDoneAt: null,
          noticeSeenAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(assistants.owner, owner), eq(assistants.agentId, agentId)),
        );
    },

    async completeRename(owner, agentId) {
      await db
        .update(assistants)
        .set({ renamedDoneAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(eq(assistants.owner, owner), eq(assistants.agentId, agentId)),
        );
    },

    async clearRename(owner, agentId) {
      await db
        .update(assistants)
        .set({
          renamedAgentId: null,
          renamedFrom: null,
          renamedTo: null,
          renamedDoneAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(assistants.owner, owner), eq(assistants.agentId, agentId)),
        );
    },

    async markNoticeSeen(owner) {
      await db
        .update(assistants)
        .set({ noticeSeenAt: sql`now()` })
        .where(eq(assistants.owner, owner));
    },

    async markUsed(agentId) {
      await db
        .update(assistants)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(assistants.agentId, agentId),
            sql`${assistants.usedAt} IS NULL`,
          ),
        );
    },

    async forgetByAgent(agentId) {
      await db
        .update(assistants)
        .set({ state: "gone", updatedAt: sql`now()` })
        .where(eq(assistants.agentId, agentId));
    },

    async listAgentIds() {
      const rows = await db
        .select({ agentId: assistants.agentId })
        .from(assistants);
      return rows.map((r) => r.agentId);
    },
  };
}
