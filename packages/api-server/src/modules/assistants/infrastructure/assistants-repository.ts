import { and, assistants, eq, sql, type Db } from "db";

/** UNIT_BOUNDARY_DESCRIPTION: how far provisioning has got with the owner's assistant: its Agent is being made, is there, or was deleted and can be made again. */
export type AssistantRowState = "creating" | "ready" | "gone";

export interface AssistantRename {
  agentId: string;
  from: string;
  to: string;
}

export interface AssistantRow {
  owner: string;
  agentId: string;
  state: AssistantRowState;
  used: boolean;
  renamed: AssistantRename | null;
  noticeSeen: boolean;
}

export interface AssistantsRepository {
  find(owner: string): Promise<AssistantRow | null>;
  reserve(owner: string, agentId: string): Promise<boolean>;
  takeOver(owner: string, agentId: string, staleMs: number): Promise<boolean>;
  markReady(owner: string, agentId: string): Promise<void>;
  recordRename(
    owner: string,
    agentId: string,
    rename: AssistantRename,
  ): Promise<void>;
  clearRename(owner: string, agentId: string): Promise<void>;
  markNoticeSeen(owner: string): Promise<void>;
  markUsed(agentId: string): Promise<void>;
  forgetByAgent(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
}

const COLUMNS = {
  owner: assistants.owner,
  agentId: assistants.agentId,
  state: assistants.state,
  usedAt: assistants.usedAt,
  renamedAgentId: assistants.renamedAgentId,
  renamedFrom: assistants.renamedFrom,
  renamedTo: assistants.renamedTo,
  noticeSeenAt: assistants.noticeSeenAt,
};

type Row = {
  owner: string;
  agentId: string;
  state: string;
  usedAt: Date | null;
  renamedAgentId: string | null;
  renamedFrom: string | null;
  renamedTo: string | null;
  noticeSeenAt: Date | null;
};

function toRow(row: Row): AssistantRow {
  return {
    owner: row.owner,
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
          }
        : null,
    noticeSeen: row.noticeSeenAt !== null,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The row per owner that makes the assistant one per
 * owner, and the durable record of provisioning it. Every call is one statement:
 * nothing holds a pool connection across the Agent's creation, which the
 * api-server performs on its own connections. `reserve` is the claim — its
 * primary key admits one winner and the losers get false, so contention costs
 * no wait. `takeOver` refreshes a claim a dead replica left behind, or one whose
 * Agent was deleted, again with a single winner; a claim younger than its bound
 * is left to the request that holds it.
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

    async reserve(owner, agentId) {
      const inserted = await db
        .insert(assistants)
        .values({ owner, agentId, state: "creating" })
        .onConflictDoNothing()
        .returning({ owner: assistants.owner });
      return inserted.length > 0;
    },

    async takeOver(owner, agentId, staleMs) {
      const taken = await db
        .update(assistants)
        .set({ updatedAt: sql`now()` })
        .where(
          and(
            eq(assistants.owner, owner),
            eq(assistants.agentId, agentId),
            sql`(${assistants.state} <> 'creating' OR ${assistants.updatedAt} < now() - make_interval(secs => ${staleMs / 1000}))`,
          ),
        )
        .returning({ owner: assistants.owner });
      return taken.length > 0;
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
          noticeSeenAt: null,
          updatedAt: sql`now()`,
        })
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
