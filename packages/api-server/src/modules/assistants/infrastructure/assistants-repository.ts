import type { FirstResultKind } from "api-server-api";
import {
  and,
  dambledoreProvisioned,
  eq,
  isNull,
  sql,
  type Db,
  type DbTx,
} from "db";

/** UNIT_BOUNDARY_DESCRIPTION: how far the assistant has got: its Agent is being made, or it is there. A `creating` row is a create in flight, not a deleted assistant, so nothing that finds one may make a second. */
export type AssistantState = "creating" | "ready";

export interface AssistantRow {
  owner: string;
  agentId: string;
  state: AssistantState;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the account had an Agent of its own before the platform gave it this one, written once and never recomputed. */
  legacy: boolean;
  used: boolean;
  resetAt: Date | null;
  firstResult: {
    kind: FirstResultKind;
    ref: string | null;
    at: Date;
    /* UNIT_BOUNDARY_DESCRIPTION: whether the checklist write and the announcement behind the claim have run — a claim that never completed is finished by the next caller. */
    completed: boolean;
  } | null;
  /* UNIT_BOUNDARY_DESCRIPTION: how many onboarding resets this person's record has taken, which is what says whether a report began in the onboarding it is finishing. */
  epoch: number;
}

/** UNIT_BOUNDARY_DESCRIPTION: what a Session report needs to know about the record it may mark as used. */
export interface AssistantUsage {
  owner: string;
  used: boolean;
  resetAt: Date | null;
}

export interface AssistantsRepository {
  find(owner: string): Promise<AssistantRow | null>;
  /** UNIT_BOUNDARY_DESCRIPTION: settles which of several concurrent requests makes the Agent, by the primary key: exactly one insert wins, and the rest find the owner taken. It is the one write that records the account's cohort, since it happens when the platform first makes the assistant and never again. */
  claim(owner: string, agentId: string, legacy: boolean): Promise<boolean>;
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
  /* UNIT_BOUNDARY_DESCRIPTION: the first result as the per-owner transaction sees it, and the writes that transaction makes. The read takes the row's own lock, so a reset and a report cannot interleave inside it. */
  firstResultIn(tx: DbTx, owner: string): Promise<AssistantRow | null>;
  /** UNIT_BOUNDARY_DESCRIPTION: records the person's first result if none is recorded yet, and answers whether this call is the one that wrote it. */
  claimFirstResultIn(
    tx: DbTx,
    owner: string,
    kind: FirstResultKind,
    ref: string | null,
  ): Promise<boolean>;
  /** UNIT_BOUNDARY_DESCRIPTION: marks the result's side effects — the checklist write and the announcement — as done, so no later caller runs them again. */
  completeFirstResultIn(tx: DbTx, owner: string): Promise<void>;
  /** UNIT_BOUNDARY_DESCRIPTION: forgets the first result and moves the onboarding epoch on, in one transaction: a report that began in the onboarding this reset ends finds its result gone and its epoch behind. */
  clearFirstResultIn(tx: DbTx, owner: string): Promise<void>;
}

const COLUMNS = {
  owner: dambledoreProvisioned.owner,
  agentId: dambledoreProvisioned.agentId,
  state: dambledoreProvisioned.state,
  legacy: dambledoreProvisioned.legacy,
  usedAt: dambledoreProvisioned.usedAt,
  resetAt: dambledoreProvisioned.resetAt,
  firstResultKind: dambledoreProvisioned.firstResultKind,
  firstResultRef: dambledoreProvisioned.firstResultRef,
  firstResultAt: dambledoreProvisioned.firstResultAt,
  firstResultCompletedAt: dambledoreProvisioned.firstResultCompletedAt,
  epoch: dambledoreProvisioned.onboardingEpoch,
};

const isFirstResultKind = (value: string): value is FirstResultKind =>
  value === "schedule" || value === "artifact" || value === "knowledgeBase";

type SelectedRow = {
  owner: string;
  agentId: string;
  state: string;
  legacy: boolean;
  usedAt: Date | null;
  resetAt: Date | null;
  firstResultKind: string | null;
  firstResultRef: string | null;
  firstResultAt: Date | null;
  firstResultCompletedAt: Date | null;
  epoch: number;
};

function toRow(row: SelectedRow): AssistantRow {
  return {
    owner: row.owner,
    agentId: row.agentId,
    state: row.state === "ready" ? "ready" : "creating",
    legacy: row.legacy,
    used: row.usedAt !== null,
    resetAt: row.resetAt,
    epoch: row.epoch,
    firstResult:
      row.firstResultKind !== null &&
      row.firstResultAt !== null &&
      isFirstResultKind(row.firstResultKind)
        ? {
            kind: row.firstResultKind,
            ref: row.firstResultRef,
            at: row.firstResultAt,
            completed: row.firstResultCompletedAt !== null,
          }
        : null,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The row per owner that makes the assistant's create
 * happen once, and the marks that say whether it is there, whether it was ever
 * used, and what onboarding has reached. Every call that is not handed a
 * transaction is one statement, so nothing holds a pool connection across the
 * Agent's creation; the first result's own calls take the transaction its lock
 * opened, so a report and a reset settle against the same row.
 */
export function createAssistantsRepository(db: Db): AssistantsRepository {
  return {
    async find(owner) {
      const [row] = await db
        .select(COLUMNS)
        .from(dambledoreProvisioned)
        .where(eq(dambledoreProvisioned.owner, owner));
      return row === undefined ? null : toRow(row);
    },

    async claim(owner, agentId, legacy) {
      const inserted = await db
        .insert(dambledoreProvisioned)
        .values({ owner, agentId, state: "creating", legacy })
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
      if (row === undefined) return null;
      return {
        owner: row.owner,
        used: row.usedAt !== null,
        resetAt: row.resetAt,
      };
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
        .set({ usedAt: null, resetAt: sql`now()` })
        .where(eq(dambledoreProvisioned.owner, owner));
    },

    async firstResultIn(tx, owner) {
      const [row] = await tx
        .select(COLUMNS)
        .from(dambledoreProvisioned)
        .where(eq(dambledoreProvisioned.owner, owner))
        .for("update");
      return row === undefined ? null : toRow(row);
    },

    async claimFirstResultIn(tx, owner, kind, ref) {
      const claimed = await tx
        .update(dambledoreProvisioned)
        .set({
          firstResultKind: kind,
          firstResultRef: ref,
          firstResultAt: sql`now()`,
          firstResultCompletedAt: null,
        })
        .where(
          and(
            eq(dambledoreProvisioned.owner, owner),
            isNull(dambledoreProvisioned.firstResultKind),
          ),
        )
        .returning({ owner: dambledoreProvisioned.owner });
      return claimed.length > 0;
    },

    async completeFirstResultIn(tx, owner) {
      await tx
        .update(dambledoreProvisioned)
        .set({ firstResultCompletedAt: sql`now()` })
        .where(eq(dambledoreProvisioned.owner, owner));
    },

    async clearFirstResultIn(tx, owner) {
      await tx
        .update(dambledoreProvisioned)
        .set({
          firstResultKind: null,
          firstResultRef: null,
          firstResultAt: null,
          firstResultCompletedAt: null,
          onboardingEpoch: sql`${dambledoreProvisioned.onboardingEpoch} + 1`,
        })
        .where(eq(dambledoreProvisioned.owner, owner));
    },
  };
}
