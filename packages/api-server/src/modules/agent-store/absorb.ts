import { sql, type Db, type DbTx } from "db";
import {
  controlAgentConditions,
  controlAgentKitState,
  controlAgentL7Hosts,
  controlAgentSignals,
  controlAgentStatus,
  controlAgents,
  controlAgentStore,
  controlCrdSnapshots,
  controlUserBudgets,
} from "db";
import type { Logger } from "../../core/logger.js";
import type { KubeObject } from "../agents/infrastructure/k8s.js";
import type { SnapshotObjectStore } from "./backup.js";
import { writeVerifiedBackup } from "./backup.js";
import {
  blockingRefusals,
  mapBudget,
  previewAgentStore,
  readConnectionGrants,
  type Refusal,
} from "./preview.js";
import {
  rowsFromResource,
  type AgentRowMapping,
  type AgentStoreDefaults,
} from "./rows.js";
import { buildAgentStoreSnapshot } from "./snapshot.js";

export interface InstallIdentity {
  releaseName: string;
  namespace: string;
  apiServer: string | null;
}

export const installMatches = (
  recorded: InstallIdentity | null | undefined,
  live: InstallIdentity,
): boolean =>
  recorded !== null &&
  recorded !== undefined &&
  recorded.releaseName === live.releaseName &&
  recorded.namespace === live.namespace &&
  recorded.apiServer === live.apiServer;

export interface AbsorbReport {
  absorbedAt: string;
  install: InstallIdentity;
  absorbedByVersion: string;
  agents: {
    seen: number;
    imported: number;
    skipped: Refusal[];
    dropped: Record<string, number>;
    normalized: Record<string, number>;
  };
  budgets: {
    seen: number;
    imported: number;
    skipped: Refusal[];
    dropped: Record<string, number>;
    normalized: Record<string, number>;
  };
  snapshot: { documents: number; sha256: string };
  backup: { ref: string | null; sha256: string };
}

export type AbsorbOutcome =
  | { status: "absorbed"; absorbedAt: Date; report: AbsorbReport }
  | { status: "skipped"; absorbedAt: Date };

export interface AbsorbDeps {
  db: Db;
  logger: Logger;
  listCustomObjects: (plural: string) => Promise<KubeObject[]>;
  writeMarker: (data: Record<string, string>) => Promise<void>;
  readMarker: () => Promise<Record<string, string> | null>;
  install: InstallIdentity;
  store: SnapshotObjectStore | null;
  backupKeyPrefix: string;
  backupRefPrefix: string;
  defaults: AgentStoreDefaults;
  absorbedByVersion: string;
  now: Date;
}

const ABSORB_LOCK = sql`select pg_advisory_xact_lock(hashtext('control.agent_store.absorb'))`;

const insertAgent = async (
  tx: Db | DbTx,
  mapping: AgentRowMapping,
): Promise<void> => {
  const rows = mapping.rows;
  if (rows === undefined) return;
  await tx.insert(controlAgents).values(rows.agent);
  await tx.insert(controlAgentSignals).values(rows.signals);
  if (rows.kit !== null) await tx.insert(controlAgentKitState).values(rows.kit);
  if (rows.status !== null)
    await tx.insert(controlAgentStatus).values(rows.status);
  if (rows.conditions.length > 0)
    await tx.insert(controlAgentConditions).values(rows.conditions);
  if (rows.hosts.length > 0)
    await tx
      .insert(controlAgentL7Hosts)
      .values(rows.hosts.map((host) => ({ agentId: rows.agent.id, host })));
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: the switch's absorb: the one write that makes the
 * custom resources history and the rows authoritative.
 *
 * Order is the crash-safety. It reads and refuses before it writes anything,
 * because an Agent or a grant it cannot carry is one whose machine would be
 * collected as an orphan. The independent archive copy is written and read back
 * before the transaction opens, so a database that is later lost still has the
 * resources; the snapshot rows, the whole fleet and the absorb stamp commit
 * together, so a kill leaves either the old state or the new one and never a
 * fleet with missing members.
 * The marker ConfigMap is written after the commit and before the caller serves:
 * a kill in between is retried by the next start, which finds the stamp and only
 * re-writes the marker. Reruns are no-ops because the stamp is read under the
 * lock inside the transaction too.
 */
export async function absorbAgentStore(
  deps: AbsorbDeps,
): Promise<AbsorbOutcome> {
  const current = await deps.db
    .select({
      absorbedAt: controlAgentStore.absorbedAt,
      absorbReport: controlAgentStore.absorbReport,
    })
    .from(controlAgentStore)
    .where(sql`${controlAgentStore.id} = 1`)
    .limit(1);
  const stamped = current[0]?.absorbedAt ?? null;
  const marker = await deps.readMarker();
  if (stamped !== null) {
    const recorded = (
      current[0]?.absorbReport as { install?: InstallIdentity } | null
    )?.install;
    if (!installMatches(recorded, deps.install))
      throw new Error(
        `this database was absorbed by another install (${recorded?.releaseName ?? "unknown"}/${recorded?.namespace ?? "unknown"} at ${recorded?.apiServer ?? "unknown"}), not by ${deps.install.releaseName}/${deps.install.namespace} at ${deps.install.apiServer ?? "unknown"}: refusing to publish its stamp into this cluster`,
      );
    if (
      marker?.store === "postgres" &&
      marker["absorbed-at"] !== stamped.toISOString()
    )
      throw new Error(
        `the cluster's marker names an absorb at ${marker["absorbed-at"]}, but this database was absorbed at ${stamped.toISOString()}: the two are not the same store. Refusing.`,
      );
    await deps.writeMarker({
      store: "postgres",
      "absorbed-at": stamped.toISOString(),
    });
    deps.logger.info(
      { absorbedAt: stamped.toISOString() },
      "agentStore.absorb.skipped",
    );
    return { status: "skipped", absorbedAt: stamped };
  }
  if (marker?.store === "postgres")
    throw new Error(
      `the cluster's marker names an absorbed store at ${marker["absorbed-at"] ?? "an unknown time"}, but this database holds no absorb stamp: DATABASE_URL names another database, or the store was lost. Refusing to absorb into it.`,
    );

  const agents = await deps.listCustomObjects("agents");
  const budgets = await deps.listCustomObjects("userbudgets");
  const grants = await readConnectionGrants(
    deps.db,
    agents.map((cr) => cr.metadata?.name ?? "").filter((id) => id !== ""),
  );
  const preview = previewAgentStore({
    agents,
    budgets,
    grants,
    defaults: deps.defaults,
    switchedAt: deps.now.toISOString(),
  });
  deps.logger.info({ preview }, "agentStore.absorbPreview");

  const blocking = blockingRefusals(preview);
  if (blocking.length > 0)
    throw new Error(
      `the absorb refuses: ${blocking.length} record(s) would stop existing as the platform reads them. ${blocking
        .slice(0, 20)
        .join("; ")}${blocking.length > 20 ? "; …" : ""}`,
    );

  const snapshot = buildAgentStoreSnapshot({ agents, budgets });
  const content = Buffer.from(snapshot.yaml, "utf8");
  const backup =
    deps.store === null
      ? null
      : await writeVerifiedBackup({
          store: deps.store,
          keyPrefix: deps.backupKeyPrefix,
          content,
          expectedSha256: snapshot.sha256,
        });
  const backupRef =
    backup === null ? null : `${deps.backupRefPrefix}/${backup.key}`;

  const mappedAgents = agents.map((cr) =>
    rowsFromResource(cr, deps.defaults, deps.now.toISOString()),
  );
  const mappedBudgets = budgets.map(mapBudget);
  const report: AbsorbReport = {
    absorbedAt: deps.now.toISOString(),
    install: deps.install,
    absorbedByVersion: deps.absorbedByVersion,
    agents: {
      seen: preview.agents.seen,
      imported: mappedAgents.filter((one) => one.rows !== undefined).length,
      skipped: mappedAgents
        .filter((one) => one.rows === undefined && one.refusal !== undefined)
        .map((one) => ({ id: one.id, reason: one.refusal ?? "" })),
      dropped: preview.agents.dropped,
      normalized: preview.agents.normalized,
    },
    budgets: {
      seen: preview.budgets.seen,
      imported: mappedBudgets.filter((one) => one.row !== undefined).length,
      skipped: mappedBudgets
        .filter((one) => one.row === undefined && one.refusal !== undefined)
        .map((one) => ({ id: one.ownerSub, reason: one.refusal ?? "" })),
      dropped: preview.budgets.dropped,
      normalized: preview.budgets.normalized,
    },
    snapshot: {
      documents: snapshot.documents.length,
      sha256: snapshot.sha256,
    },
    backup: { ref: backupRef, sha256: snapshot.sha256 },
  };

  let outcome: AbsorbOutcome = {
    status: "absorbed",
    absorbedAt: deps.now,
    report,
  };
  await deps.db.transaction(async (tx) => {
    await tx.execute(ABSORB_LOCK);
    const locked = await tx
      .select({ absorbedAt: controlAgentStore.absorbedAt })
      .from(controlAgentStore)
      .where(sql`${controlAgentStore.id} = 1`)
      .for("update")
      .limit(1);
    const raced = locked[0]?.absorbedAt ?? null;
    if (raced !== null) {
      outcome = { status: "skipped", absorbedAt: raced };
      return;
    }

    if (snapshot.documents.length > 0)
      await tx.insert(controlCrdSnapshots).values(
        snapshot.documents.map((doc) => ({
          capturedAt: deps.now,
          kind: doc.kind,
          name: doc.name,
          uid: doc.uid,
          sha256: doc.sha256,
          yaml: doc.yaml,
        })),
      );
    for (const mapping of mappedAgents) await insertAgent(tx, mapping);
    const budgetRows = mappedBudgets
      .map((one) => one.row)
      .filter((row): row is NonNullable<typeof row> => row !== undefined);
    if (budgetRows.length > 0)
      await tx.insert(controlUserBudgets).values(budgetRows);
    await tx
      .insert(controlAgentStore)
      .values({
        id: 1,
        absorbedAt: deps.now,
        backupRef,
        absorbReport: report,
      })
      .onConflictDoUpdate({
        target: controlAgentStore.id,
        set: {
          absorbedAt: deps.now,
          backupRef,
          absorbReport: report,
        },
      });
  });

  const absorbedAt = outcome.absorbedAt;
  await deps.writeMarker({
    store: "postgres",
    "absorbed-at": absorbedAt.toISOString(),
  });
  deps.logger.info(
    {
      absorbedAt: absorbedAt.toISOString(),
      agents: report.agents,
      budgets: report.budgets,
      snapshot: report.snapshot,
      backup: report.backup,
    },
    outcome.status === "absorbed"
      ? "agentStore.absorb.committed"
      : "agentStore.absorb.skipped",
  );
  return outcome;
}
