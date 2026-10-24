import { and, eq, isNull, sql, type Db } from "db";
import { controlAgentStore } from "db";
import type { CoordinationV1Api } from "@kubernetes/client-node";

export interface CutoverBarrierDeps {
  db: Db;
  leases: CoordinationV1Api;
  namespace: string;
  leaseName: string;
  markerAbsorbedAt: string | null;
  log: (message: string, fields?: Record<string, unknown>) => void;
  deadlineMs?: number;
  pollMs?: number;
}

type Progress = {
  absorbedAt: Date | null;
  holder: string | null;
  anchorsEnsuredAt: Date | null;
  switchCompletedAt: Date | null;
};

const sameInstant = (stored: Date, marker: string | null): boolean => {
  if (marker === null) return false;
  const parsed = new Date(marker);
  if (Number.isNaN(parsed.getTime()))
    return stored.toISOString() === marker || stored.toUTCString() === marker;
  return (
    Math.abs(stored.getTime() - parsed.getTime()) < 1 ||
    stored.toISOString() === marker
  );
};

const readProgress = async (db: Db): Promise<Progress | null> => {
  const rows = await db
    .select({
      absorbedAt: controlAgentStore.absorbedAt,
      holder: controlAgentStore.controllerHolder,
      anchorsEnsuredAt: controlAgentStore.anchorsEnsuredAt,
      switchCompletedAt: controlAgentStore.switchCompletedAt,
    })
    .from(controlAgentStore)
    .where(eq(controlAgentStore.id, 1))
    .limit(1);
  return rows[0] ?? null;
};

const heldBy = async (
  leases: CoordinationV1Api,
  namespace: string,
  name: string,
): Promise<string | undefined> => {
  try {
    const lease = await leases.readNamespacedLease({ name, namespace });
    return lease.spec?.holderIdentity ?? undefined;
  } catch (cause) {
    if (
      cause instanceof Error &&
      "code" in cause &&
      (cause as { code: unknown }).code === 404
    )
      return undefined;
    throw cause;
  }
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: the api-server's half of the switch's barrier.
 *
 * Two Deployments recreate independently, so "no old writer runs" is not the
 * same as "the new controller leads". The new api-server therefore waits to
 * serve until the controller that leads the Lease is the one that recorded its
 * anchor pass, and writes that the switch is complete so later boots never wait
 * on a controller again. A controller that lost its Lease has its run cancelled
 * before the holder changes, so the Lease covers a pod a lost node keeps alive,
 * which a pod-existence check would not.
 */
export async function passCutoverBarrier(
  deps: CutoverBarrierDeps,
): Promise<"already" | "passed"> {
  const deadline = Date.now() + (deps.deadlineMs ?? 300_000);
  const pollMs = deps.pollMs ?? 2_000;
  let announced = false;

  for (;;) {
    const progress = await readProgress(deps.db);
    // UNIT_BOUNDARY_DESCRIPTION: the marker binds the cluster to this database, so a database
    // UNIT_BOUNDARY_DESCRIPTION: switched elsewhere cannot pass on its own `switch_completed_at`.
    if (progress?.absorbedAt === null || progress?.absorbedAt === undefined)
      throw new Error(
        "the store has no absorb stamp: this is not the database the cluster switched to. Refusing to serve it.",
      );
    if (!sameInstant(progress.absorbedAt, deps.markerAbsorbedAt))
      throw new Error(
        `the store was absorbed at ${progress.absorbedAt.toISOString()}, the marker names ${deps.markerAbsorbedAt ?? "nothing"}: the database and the cluster are not the same install. Refusing to serve it.`,
      );
    if (progress.switchCompletedAt) return "already";
    if (progress?.holder && progress.anchorsEnsuredAt) {
      const holder = await heldBy(deps.leases, deps.namespace, deps.leaseName);
      if (holder === progress.holder) {
        const written = await deps.db
          .update(controlAgentStore)
          .set({ switchCompletedAt: sql`now()` })
          .where(
            and(
              eq(controlAgentStore.id, 1),
              isNull(controlAgentStore.switchCompletedAt),
            ),
          )
          .returning({ id: controlAgentStore.id });
        if (written.length > 0) {
          deps.log("the cutover barrier passed: the new controller leads", {
            holder,
          });
          return "passed";
        }
        return "already";
      }
    }
    if (Date.now() >= deadline)
      throw new Error(
        `the cutover barrier did not pass within ${Math.round((deps.deadlineMs ?? 300_000) / 1000)}s: the controller has not led and recorded its anchor pass${
          progress?.holder ? ` (the store names ${progress.holder})` : ""
        }. The api-server serves nothing until it does; check the controller's logs and its database credential.`,
      );
    if (!announced) {
      announced = true;
      deps.log(
        "waiting for the new controller to lead and record its anchor pass",
        { storeHolder: progress?.holder ?? null },
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
