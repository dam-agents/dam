import type { KubeObject } from "../agents/infrastructure/k8s.js";

export type RollbackVerdict =
  | { action: "noop"; reason: string }
  | { action: "refuse"; reason: string }
  | { action: "restore" };

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a rollback may do to a cluster, decided before
 * it touches anything.
 *
 * The command is run by a person under pressure, sometimes twice, sometimes
 * against the wrong database. An empty store is not a fleet that vanished: it is
 * a database that was never absorbed, another install's database, or a rollback
 * that already finished — and in the first two cases the only safe action is
 * none. So the stamp and the cluster's marker decide, the rows are never allowed
 * to translate into "delete every custom resource", and a rerun after a finished
 * rollback is a no-op.
 */
export function rollbackVerdict(input: {
  absorbedAt: Date | null;
  markerStore: string | null;
  agentRows: number;
  liveAgents: number;
}): RollbackVerdict {
  if (input.absorbedAt === null) {
    if (input.markerStore === "postgres")
      return {
        action: "refuse",
        reason:
          "the cluster's marker says postgres but the database holds no absorb stamp: DATABASE_URL names another install's database, or the store was never absorbed",
      };
    return {
      action: "noop",
      reason:
        "the Agent store is not absorbed (or the rollback already finished); no custom resource is touched",
    };
  }
  // UNIT_BOUNDARY_DESCRIPTION: a missing marker with a stamp is the one window a killed rollback leaves (the marker is deleted before the rows), so it finishes rather than refuses; any other marker value is a cluster that was pinned without rolling back.
  if (input.markerStore !== null && input.markerStore !== "postgres")
    return {
      action: "refuse",
      reason: `the cluster's marker says ${input.markerStore}, so this database is not the store the cluster serves`,
    };
  if (input.agentRows === 0 && input.liveAgents > 0)
    return {
      action: "refuse",
      reason: `the store is absorbed but holds no Agent rows while ${input.liveAgents} Agent custom resource(s) are live: not a state a rollback can restore, and deleting every custom resource is what it must not do`,
    };
  return { action: "restore" };
}

export interface RestoreBody {
  body: Record<string, unknown>;
  status: Record<string, unknown> | undefined;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the object a rollback writes, whole.
 *
 * A merge patch keeps every field it omits, so a grant revoked, a host removed
 * or a flag turned off after the switch would come back with the value it had at
 * the switch — a restored credential the owner no longer grants. A replace
 * writes exactly what the rows hold, and keeps the fields the cluster owns: the
 * finalizers, the owner references and the version it read.
 */
export function restoreBody(input: {
  resource: { kind: string; resource: KubeObject };
  live: KubeObject | null;
  namespace: string;
}): RestoreBody {
  const body = JSON.parse(JSON.stringify(input.resource.resource)) as Record<
    string,
    unknown
  >;
  const metadata = (body.metadata ?? {}) as Record<string, unknown>;
  delete metadata.uid;
  delete metadata.generation;
  delete metadata.creationTimestamp;
  delete metadata.resourceVersion;
  metadata.namespace = input.namespace;
  if (input.live?.metadata) {
    const liveMeta = input.live.metadata as Record<string, unknown>;
    metadata.resourceVersion = liveMeta.resourceVersion;
    if (liveMeta.finalizers !== undefined)
      metadata.finalizers = liveMeta.finalizers;
    if (liveMeta.ownerReferences !== undefined)
      metadata.ownerReferences = liveMeta.ownerReferences;
  }
  const status = body.status as Record<string, unknown> | undefined;
  delete body.status;
  return { body, status };
}

export function statusBody(
  status: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (status === undefined) return undefined;
  const kept: Record<string, unknown> = {};
  for (const key of [
    "conditions",
    "observedGeneration",
    "agentPodRestarts",
    "agentPodRestartReason",
  ])
    if (status[key] !== undefined) kept[key] = status[key];
  return kept;
}

export function attestedDigestMatches(
  recorded: string | null | undefined,
  attested: string,
): boolean {
  return (
    typeof recorded === "string" &&
    recorded.toLowerCase() === attested.toLowerCase()
  );
}
