import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type Db,
  invocations as invocationsTable,
  invocationRuns as runsTable,
} from "db";
import { toRow, type InvocationRow } from "./invocations-repository.js";

export interface SubAgentOutcomesRepository {
  markAwaited(
    driverAgentId: string,
    runIds: string[],
    until: Date,
  ): Promise<void>;
  collect(driverAgentId: string, runIds: string[]): Promise<CollectOutcome>;
  claimUndelivered(limit: number, until: Date): Promise<InvocationRow[]>;
  release(runIds: string[], lease: Date): Promise<void>;
  markDelivered(runIds: string[], lease: Date, inTurn: boolean): Promise<void>;
  markWoken(runIds: string[]): Promise<void>;
  listDeliveredUnwoken(limit: number): Promise<InvocationRow[]>;
}

export interface CollectOutcome {
  inTurn: string[];
}

const terminalToolOutcome = () =>
  and(
    eq(runsTable.origin, "tool"),
    inArray(runsTable.status, ["done", "failed"]),
  );

const unclaimed = () =>
  sql`(${runsTable.claimedUntil} is null or ${runsTable.claimedUntil} < now())`;

const claimable = () =>
  and(
    terminalToolOutcome(),
    isNull(runsTable.deliveredAt),
    sql`(${runsTable.awaitedUntil} is null or ${runsTable.awaitedUntil} < now())`,
    unclaimed(),
  );

/**
 * UNIT_BOUNDARY_DESCRIPTION: The delivery bookkeeping on a tool-started run of
 * an Invocation. A claim is a lease, not a delivery: `claimedUntil` holds the
 * run for one tick, and only the turn being written sets `deliveredAt`, so a
 * server that dies between the two leaves a run the next tick claims again.
 * A wait collects a run only where no tick holds it, in one conditional write,
 * so a turn and a wait never both deliver the same outcome.
 */
export function createSubAgentOutcomesRepository(
  db: Db,
): SubAgentOutcomesRepository {
  const drivenBy = (driverAgentId: string) =>
    inArray(
      runsTable.invocationId,
      db
        .select({ id: invocationsTable.id })
        .from(invocationsTable)
        .where(eq(invocationsTable.driverAgentId, driverAgentId)),
    );

  async function withTargets(
    runs: (typeof runsTable.$inferSelect)[],
  ): Promise<InvocationRow[]> {
    if (runs.length === 0) return [];
    const targets = await db
      .select()
      .from(invocationsTable)
      .where(
        inArray(invocationsTable.id, [
          ...new Set(runs.map((r) => r.invocationId)),
        ]),
      );
    const byId = new Map(targets.map((t) => [t.id, t]));
    return runs.flatMap((r) => {
      const target = byId.get(r.invocationId);
      return target ? [toRow(target, r)] : [];
    });
  }

  return {
    async markAwaited(driverAgentId, runIds, until) {
      if (runIds.length === 0) return;
      await db
        .update(runsTable)
        .set({ awaitedUntil: until })
        .where(and(drivenBy(driverAgentId), inArray(runsTable.id, runIds)));
    },

    async collect(driverAgentId, runIds) {
      if (runIds.length === 0) return { inTurn: [] };
      const now = new Date();
      const asked = () =>
        and(drivenBy(driverAgentId), inArray(runsTable.id, runIds));
      await db
        .update(runsTable)
        .set({ deliveredAt: now, wokeAt: now, claimedUntil: null })
        .where(and(asked(), isNull(runsTable.deliveredAt), unclaimed()));
      const inTurn = await db
        .select({ id: runsTable.id })
        .from(runsTable)
        .where(
          and(
            asked(),
            or(
              eq(runsTable.deliveredInTurn, true),
              and(
                isNull(runsTable.deliveredAt),
                isNotNull(runsTable.claimedUntil),
              ),
            ),
          ),
        );
      return { inTurn: inTurn.map((r) => r.id) };
    },

    async claimUndelivered(limit, until) {
      const oldest = await db
        .select({ id: runsTable.id })
        .from(runsTable)
        .where(claimable())
        .orderBy(runsTable.completedAt)
        .limit(limit);
      if (oldest.length === 0) return [];
      const runs = await db
        .update(runsTable)
        .set({ claimedUntil: until })
        .where(
          and(
            claimable(),
            inArray(
              runsTable.id,
              oldest.map((r) => r.id),
            ),
          ),
        )
        .returning();
      return withTargets(runs);
    },

    async release(runIds, lease) {
      if (runIds.length === 0) return;
      await db
        .update(runsTable)
        .set({ claimedUntil: null })
        .where(
          and(
            inArray(runsTable.id, runIds),
            eq(runsTable.claimedUntil, lease),
            isNull(runsTable.deliveredAt),
          ),
        );
    },

    async markDelivered(runIds, lease, inTurn) {
      if (runIds.length === 0) return;
      await db
        .update(runsTable)
        .set({
          deliveredAt: new Date(),
          deliveredInTurn: inTurn,
          claimedUntil: null,
        })
        .where(
          and(
            inArray(runsTable.id, runIds),
            eq(runsTable.claimedUntil, lease),
            isNull(runsTable.deliveredAt),
          ),
        );
    },

    async markWoken(runIds) {
      if (runIds.length === 0) return;
      await db
        .update(runsTable)
        .set({ wokeAt: new Date() })
        .where(inArray(runsTable.id, runIds));
    },

    async listDeliveredUnwoken(limit) {
      return withTargets(
        await db
          .select()
          .from(runsTable)
          .where(
            and(
              terminalToolOutcome(),
              isNotNull(runsTable.deliveredAt),
              isNull(runsTable.wokeAt),
            ),
          )
          .limit(limit),
      );
    },
  };
}
