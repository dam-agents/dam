import { and, dambledoreProvisioned, eq, isNull, sql, type Db } from "db";

export interface AssistantRow {
  owner: string;
  agentId: string;
  used: boolean;
}

export interface AssistantsRepository {
  find(owner: string): Promise<AssistantRow | null>;
  /** UNIT_BOUNDARY_DESCRIPTION: settles which of several concurrent requests makes the Agent, by the primary key: exactly one insert wins, and the rest find the owner taken. */
  claim(owner: string, agentId: string): Promise<boolean>;
  /** UNIT_BOUNDARY_DESCRIPTION: gives up a claim whose Agent was never made, so a later request may try again; a claim whose Agent exists stays. */
  release(owner: string, agentId: string): Promise<void>;
  /** UNIT_BOUNDARY_DESCRIPTION: points the row at a replacement Agent, and forgets that the old one was used — a compare-and-set on the old id, so two resets that recreate it make one Agent between them. */
  replaceAgent(
    owner: string,
    fromAgentId: string,
    toAgentId: string,
  ): Promise<boolean>;
  markUsed(agentId: string): Promise<void>;
  /** UNIT_BOUNDARY_DESCRIPTION: forgets that the assistant was ever used, and nothing else — never the Agent itself. */
  resetUsed(owner: string): Promise<void>;
}

const COLUMNS = {
  owner: dambledoreProvisioned.owner,
  agentId: dambledoreProvisioned.agentId,
  usedAt: dambledoreProvisioned.usedAt,
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: The row per owner that makes the assistant's create
 * happen once, and the mark that says whether it was ever used. Every call is one
 * statement, so nothing holds a pool connection across the Agent's creation, and
 * none of them waits for another.
 */
export function createAssistantsRepository(db: Db): AssistantsRepository {
  return {
    async find(owner) {
      const [row] = await db
        .select(COLUMNS)
        .from(dambledoreProvisioned)
        .where(eq(dambledoreProvisioned.owner, owner));
      return row
        ? { owner: row.owner, agentId: row.agentId, used: row.usedAt !== null }
        : null;
    },

    async claim(owner, agentId) {
      const inserted = await db
        .insert(dambledoreProvisioned)
        .values({ owner, agentId })
        .onConflictDoNothing()
        .returning({ owner: dambledoreProvisioned.owner });
      return inserted.length > 0;
    },

    async release(owner, agentId) {
      await db
        .delete(dambledoreProvisioned)
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
        .set({ agentId: toAgentId, usedAt: null })
        .where(
          and(
            eq(dambledoreProvisioned.owner, owner),
            eq(dambledoreProvisioned.agentId, fromAgentId),
          ),
        )
        .returning({ owner: dambledoreProvisioned.owner });
      return moved.length > 0;
    },

    async markUsed(agentId) {
      // UNIT_BOUNDARY_DESCRIPTION: every Session report asks this, and only the assistant's own Agent matches; the table holds one row per owner, so the miss is a scan of that and writes nothing.
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
        .set({ usedAt: null })
        .where(eq(dambledoreProvisioned.owner, owner));
    },
  };
}
