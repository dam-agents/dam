import { and, assistants, eq, sql, type Db } from "db";

import { AGENT_INIT_STEPS, type AgentInitStep } from "api-server-api";

import type { AssistantRename } from "../domain/types.js";

/** UNIT_BOUNDARY_DESCRIPTION: how far provisioning has got with the owner's assistant: its Agent still has steps to run, or it is initialized, or it was deleted. */
export type AssistantRowState = "creating" | "ready" | "gone";

export interface AssistantRow {
  owner: string;
  incarnation: number;
  agentId: string;
  state: AssistantRowState;
  steps: readonly AgentInitStep[];
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
  /** UNIT_BOUNDARY_DESCRIPTION: records that one initialization step landed, before anything else runs, so a retry skips it and never re-applies what the owner may have changed since. */
  markInitStep(
    owner: string,
    agentId: string,
    step: AgentInitStep,
  ): Promise<void>;
  markReady(owner: string, agentId: string): Promise<void>;
  recordRename(
    owner: string,
    agentId: string,
    rename: AssistantRename,
  ): Promise<void>;
  completeRename(owner: string, agentId: string): Promise<void>;
  clearRename(owner: string, agentId: string): Promise<void>;
  markNoticeSeen(owner: string): Promise<void>;
  /** UNIT_BOUNDARY_DESCRIPTION: forgets that the assistant was ever used, and nothing else — not the rename it made room with, not the notice, and never the Agent itself. */
  resetUsed(owner: string): Promise<void>;
  /**
   * UNIT_BOUNDARY_DESCRIPTION: forgets the assistant entirely after its Agent was
   * deleted: the next incarnation's Agent id, nothing initialized, never used,
   * and no rename record or notice — the Agent that was renamed stays as it is.
   */
  forgetAll(
    owner: string,
    fromAgentId: string,
    toAgentId: string,
  ): Promise<void>;
  markUsed(agentId: string): Promise<void>;
  forgetByAgent(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
}

const COLUMNS = {
  owner: assistants.owner,
  incarnation: assistants.incarnation,
  agentId: assistants.agentId,
  state: assistants.state,
  initSteps: assistants.initSteps,
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
  initSteps: string[];
  usedAt: Date | null;
  renamedAgentId: string | null;
  renamedFrom: string | null;
  renamedTo: string | null;
  renamedDoneAt: Date | null;
  noticeSeenAt: Date | null;
};

const isInitStep = (value: string): value is AgentInitStep =>
  (AGENT_INIT_STEPS as readonly string[]).includes(value);

function toRow(row: Row): AssistantRow {
  return {
    owner: row.owner,
    incarnation: row.incarnation,
    agentId: row.agentId,
    state:
      row.state === "ready" || row.state === "gone" ? row.state : "creating",
    steps: row.initSteps.filter(isInitStep),
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
          initSteps: [],
          usedAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(assistants.owner, owner), eq(assistants.agentId, fromAgentId)),
        )
        .returning({ owner: assistants.owner });
      return moved.length > 0;
    },

    async markInitStep(owner, agentId, step) {
      await db
        .update(assistants)
        .set({
          initSteps: sql`array_append(${assistants.initSteps}, ${step})`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(assistants.owner, owner),
            eq(assistants.agentId, agentId),
            sql`NOT (${step} = ANY(${assistants.initSteps}))`,
          ),
        );
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

    async forgetAll(owner, fromAgentId, toAgentId) {
      await db
        .update(assistants)
        .set({
          incarnation: sql`${assistants.incarnation} + 1`,
          agentId: toAgentId,
          state: "creating",
          initSteps: [],
          usedAt: null,
          renamedAgentId: null,
          renamedFrom: null,
          renamedTo: null,
          renamedDoneAt: null,
          noticeSeenAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(assistants.owner, owner), eq(assistants.agentId, fromAgentId)),
        );
    },

    async resetUsed(owner) {
      await db
        .update(assistants)
        .set({ usedAt: null, updatedAt: sql`now()` })
        .where(eq(assistants.owner, owner));
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
