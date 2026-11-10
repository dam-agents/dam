import { and, dambledoreProvisioned, eq, isNull, sql, type Db } from "db";

/** UNIT_BOUNDARY_DESCRIPTION: how far the assistant has got: its Agent is being made, or it is there. A `creating` row is a create in flight, not a deleted assistant, so nothing that finds one may make a second. */
export type AssistantState = "creating" | "ready";

export interface AssistantRow {
  owner: string;
  agentId: string;
  state: AssistantState;
  used: boolean;
  resetAt: Date | null;
}

/** UNIT_BOUNDARY_DESCRIPTION: what a Session report needs to know about the record it may mark as used. */
export interface AssistantUsage {
  owner: string;
  used: boolean;
  resetAt: Date | null;
}

export interface AssistantsRepository {
  find(owner: string): Promise<AssistantRow | null>;
  /** UNIT_BOUNDARY_DESCRIPTION: settles which of several concurrent requests makes the Agent, by the primary key: exactly one insert wins, and the rest find the owner taken. */
  claim(owner: string, agentId: string): Promise<boolean>;
  /** UNIT_BOUNDARY_DESCRIPTION: records that the Agent the row names is there, so a create in flight is no longer mistaken for one. */
  markReady(owner: string, agentId: string): Promise<void>;
  /** UNIT_BOUNDARY_DESCRIPTION: points the row at a replacement Agent and starts the person's onboarding over on it — a compare-and-set on the old id, so two callers that replace the same Agent make one replacement between them. */
  replaceAgent(
    owner: string,
    fromAgentId: string,
    toAgentId: string,
  ): Promise<boolean>;
  usageOf(agentId: string): Promise<AssistantUsage | null>;
  markUsed(agentId: string): Promise<void>;
  /** UNIT_BOUNDARY_DESCRIPTION: starts the person's onboarding over: unused again, and every Session that began before now stops counting as a use. */
  resetUsed(owner: string): Promise<void>;
}

const COLUMNS = {
  owner: dambledoreProvisioned.owner,
  agentId: dambledoreProvisioned.agentId,
  state: dambledoreProvisioned.state,
  usedAt: dambledoreProvisioned.usedAt,
  resetAt: dambledoreProvisioned.resetAt,
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: The row per owner that makes the assistant's create
 * happen once, and the marks that say whether it is there and whether it was ever
 * used. Every call is one statement, so nothing holds a pool connection across
 * the Agent's creation, and none of them waits for another.
 */
export function createAssistantsRepository(db: Db): AssistantsRepository {
  return {
    async find(owner) {
      const [row] = await db
        .select(COLUMNS)
        .from(dambledoreProvisioned)
        .where(eq(dambledoreProvisioned.owner, owner));
      if (!row) return null;
      return {
        owner: row.owner,
        agentId: row.agentId,
        state: row.state === "ready" ? "ready" : "creating",
        used: row.usedAt !== null,
        resetAt: row.resetAt,
      };
    },

    async claim(owner, agentId) {
      const inserted = await db
        .insert(dambledoreProvisioned)
        .values({ owner, agentId, state: "creating" })
        .onConflictDoNothing()
        .returning({ owner: dambledoreProvisioned.owner });
      return inserted.length > 0;
    },

    async markReady(owner, agentId) {
      await db
        .update(dambledoreProvisioned)
        .set({ state: "ready" })
        .where(
          and(
            eq(dambledoreProvisioned.owner, owner),
            eq(dambledoreProvisioned.agentId, agentId),
          ),
        );
    },

    async replaceAgent(owner, fromAgentId, toAgentId) {
      const moved = await db
        .update(dambledoreProvisioned)
        .set({
          agentId: toAgentId,
          state: "creating",
          usedAt: null,
          resetAt: sql`now()`,
        })
        .where(
          and(
            eq(dambledoreProvisioned.owner, owner),
            eq(dambledoreProvisioned.agentId, fromAgentId),
          ),
        )
        .returning({ owner: dambledoreProvisioned.owner });
      return moved.length > 0;
    },

    async usageOf(agentId) {
      const [row] = await db
        .select(COLUMNS)
        .from(dambledoreProvisioned)
        .where(eq(dambledoreProvisioned.agentId, agentId));
      if (!row) return null;
      return {
        owner: row.owner,
        used: row.usedAt !== null,
        resetAt: row.resetAt,
      };
    },

    async markUsed(agentId) {
      await db
        .update(dambledoreProvisioned)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(dambledoreProvisioned.agentId, agentId),
            isNull(dambledoreProvisioned.usedAt),
          ),
        );
    },

    async resetUsed(owner) {
      await db
        .update(dambledoreProvisioned)
        .set({ usedAt: null, resetAt: sql`now()` })
        .where(eq(dambledoreProvisioned.owner, owner));
    },
  };
}
