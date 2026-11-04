import { assistants, eq, sql, type Db, type DbTx } from "db";

export interface AssistantRow {
  owner: string;
  agentId: string | null;
  renamed: { agentId: string; from: string; to: string } | null;
  noticeSeen: boolean;
}

export interface Provisioned {
  agentId: string;
  renamed?: { agentId: string; from: string; to: string };
}

export interface AssistantsRepository {
  find(owner: string): Promise<AssistantRow | null>;
  provision(
    owner: string,
    make: (current: AssistantRow | null) => Promise<Provisioned | null>,
  ): Promise<void>;
  markNoticeSeen(owner: string): Promise<void>;
  forgetByAgent(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
}

const COLUMNS = {
  owner: assistants.owner,
  agentId: assistants.agentId,
  renamedAgentId: assistants.renamedAgentId,
  renamedFrom: assistants.renamedFrom,
  renamedTo: assistants.renamedTo,
  noticeSeenAt: assistants.noticeSeenAt,
};

type Row = {
  owner: string;
  agentId: string | null;
  renamedAgentId: string | null;
  renamedFrom: string | null;
  renamedTo: string | null;
  noticeSeenAt: Date | null;
};

function toRow(row: Row): AssistantRow {
  return {
    owner: row.owner,
    agentId: row.agentId,
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

async function readRow(
  db: Db | DbTx,
  owner: string,
): Promise<AssistantRow | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(assistants)
    .where(eq(assistants.owner, owner));
  return row ? toRow(row) : null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The row per owner that makes the assistant one per
 * owner. `provision` serializes everything one owner's provisioning does with a
 * transaction-scoped advisory lock on their sub, so two tabs signing in at once
 * create one Agent: the first holds the lock, reads the row, makes the Agent and
 * writes the row; the second waits, then finds the row filled and makes nothing.
 * A create that fails writes nothing, so the next request tries again; a row
 * whose `agent_id` was emptied — its Agent was deleted — is filled by the next
 * one too.
 */
export function createAssistantsRepository(db: Db): AssistantsRepository {
  return {
    find: (owner) => readRow(db, owner),

    async provision(owner, make) {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('assistant'), hashtext(${owner}))`,
        );
        const current = await readRow(tx, owner);
        const next = await make(current);
        if (next === null) return;
        await tx
          .insert(assistants)
          .values({
            owner,
            agentId: next.agentId,
            renamedAgentId: next.renamed?.agentId ?? null,
            renamedFrom: next.renamed?.from ?? null,
            renamedTo: next.renamed?.to ?? null,
          })
          .onConflictDoUpdate({
            target: assistants.owner,
            set: {
              agentId: next.agentId,
              ...(next.renamed
                ? {
                    renamedAgentId: next.renamed.agentId,
                    renamedFrom: next.renamed.from,
                    renamedTo: next.renamed.to,
                    noticeSeenAt: null,
                  }
                : {}),
            },
          });
      });
    },

    async markNoticeSeen(owner) {
      await db
        .update(assistants)
        .set({ noticeSeenAt: sql`now()` })
        .where(eq(assistants.owner, owner));
    },

    async forgetByAgent(agentId) {
      await db
        .update(assistants)
        .set({ agentId: null })
        .where(eq(assistants.agentId, agentId));
    },

    async listAgentIds() {
      const rows = await db
        .select({ agentId: assistants.agentId })
        .from(assistants);
      return rows.flatMap((r) => (r.agentId === null ? [] : [r.agentId]));
    },
  };
}
