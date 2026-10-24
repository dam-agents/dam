import { createHash } from "node:crypto";
import { controlAgentStore, controlCrdSnapshots, eq, sql, type Db } from "db";
import { CONTRACT_MARKER_KEY } from "./fence.js";
import { orderDocuments } from "./snapshot.js";

export const CONTRACT_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface ContractFacts {
  now: Date;
  switchedAt: Date | null;
  documents: number;
  recordedSha256: string | null;
  archiveSha256: string | null;
  backupRef: string | null;
  attestedSha256: string | null;
  emptyArchive: boolean;
}

export type ContractVerdict =
  | { ok: true; switchedAt: Date; archived: false }
  | {
      ok: true;
      switchedAt: Date;
      archived: true;
      sha256: string;
      backupRef: string | null;
    }
  | { ok: false; reason: string };

const refused = (reason: string): ContractVerdict => ({ ok: false, reason });

/**
 * UNIT_BOUNDARY_DESCRIPTION: the contract gate, decided before a release stops
 * reading the custom resources the rollback window exists for.
 *
 * The release that deletes an install's custom resources is the first
 * irreversible step, so it refuses on four facts instead of trusting its
 * values: the install was switched, the window has closed, the archive the
 * switch stored still reads back to the digest the absorb recorded, and the
 * operator attested that digest from the copy that left the platform. An
 * install that never absorbed a custom resource has nothing to roll back and
 * says so instead of silencing the same checks.
 */
export function contractVerdict(
  input: ContractFacts,
  windowDays: number = CONTRACT_WINDOW_DAYS,
): ContractVerdict {
  if (input.switchedAt === null)
    return refused(
      "the Agent store was never switched: the contract release follows a completed cutover, and this database holds no switch stamp",
    );
  if (input.emptyArchive) {
    if (input.documents > 0)
      return refused(
        `this install absorbed ${input.documents} custom resource document(s), so it has an archive to attest: clear agentStore.contract.emptyArchive and set agentStore.contract.backupSha256 instead`,
      );
    return { ok: true, switchedAt: input.switchedAt, archived: false };
  }
  const closesAt = new Date(input.switchedAt.getTime() + windowDays * DAY_MS);
  if (input.now.getTime() < closesAt.getTime()) {
    const remaining = Math.ceil(
      (closesAt.getTime() - input.now.getTime()) / DAY_MS,
    );
    return refused(
      `the rollback window closes at ${closesAt.toISOString()}, ${remaining} day(s) after the switch at ${input.switchedAt.toISOString()}: the contract release may not follow a switch inside its window, because the custom resources are the only copy a rollback restores from`,
    );
  }
  if (input.archiveSha256 === null || input.recordedSha256 === null)
    return refused(
      "the database holds no archive: the switch stored no snapshot documents and no digest, so nothing attests what this install is leaving behind",
    );
  if (input.archiveSha256 !== input.recordedSha256)
    return refused(
      `the snapshot table reads back to sha256 ${input.archiveSha256}, not the ${input.recordedSha256} the absorb recorded: the archive is not the one the switch verified, so it is not one to delete the custom resources against`,
    );
  if (input.attestedSha256 === null)
    return refused(
      `the archive is ${input.recordedSha256} but no operator attested it: set agentStore.contract.backupSha256 to the digest export-snapshot printed, from the encrypted file the key holder keeps`,
    );
  if (input.attestedSha256 !== input.recordedSha256)
    return refused(
      `the operator attests sha256 ${input.attestedSha256}, but the absorb recorded ${input.recordedSha256}${
        input.backupRef === null
          ? " and no object store holds a second copy"
          : ` and the object-store copy is ${input.backupRef}`
      }: the attested file and the archive are not the same bytes, so one of the two is not this install's archive`,
    );
  return {
    ok: true,
    switchedAt: input.switchedAt,
    archived: true,
    sha256: input.recordedSha256,
    backupRef: input.backupRef,
  };
}

export interface ArchiveRead {
  documents: number;
  sha256: string;
  yaml: string;
}

const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

/**
 * UNIT_BOUNDARY_DESCRIPTION: the archive as the database holds it, rebuilt the
 * way export-snapshot writes it, so the digest the operator attests is the
 * digest this reads back.
 *
 * The ordering is the platform's own rather than the database's: a collation
 * that sorts differently would hash the same documents to another value.
 */
export async function readArchive(db: Db): Promise<ArchiveRead | null> {
  const captured = await db
    .select({ at: controlCrdSnapshots.capturedAt })
    .from(controlCrdSnapshots)
    .orderBy(sql`${controlCrdSnapshots.capturedAt} DESC`)
    .limit(1);
  const at = captured[0]?.at;
  if (!at) return null;
  const documents = orderDocuments(
    await db
      .select()
      .from(controlCrdSnapshots)
      .where(eq(controlCrdSnapshots.capturedAt, at)),
  );
  return {
    documents: documents.length,
    sha256: sha256(documents.map((doc) => doc.yaml).join("---\n")),
    yaml: documents.map((doc) => doc.yaml).join("---\n"),
  };
}

export async function readContractFacts(
  db: Db,
  input: {
    now: Date;
    attestedSha256: string | null;
    emptyArchive: boolean;
  },
): Promise<ContractFacts> {
  const rows = await db
    .select({
      switchedAt: controlAgentStore.switchCompletedAt,
      backupRef: controlAgentStore.backupRef,
      absorbReport: controlAgentStore.absorbReport,
    })
    .from(controlAgentStore)
    .where(eq(controlAgentStore.id, 1))
    .limit(1);
  const report = rows[0]?.absorbReport as
    { backup?: { sha256?: string } } | null | undefined;
  const archive = await readArchive(db);
  return {
    now: input.now,
    switchedAt: rows[0]?.switchedAt ?? null,
    documents: archive?.documents ?? 0,
    recordedSha256: report?.backup?.sha256 ?? null,
    archiveSha256: archive?.sha256 ?? null,
    backupRef: rows[0]?.backupRef ?? null,
    attestedSha256: input.attestedSha256,
    emptyArchive: input.emptyArchive,
  };
}

export const describeContract = (verdict: ContractVerdict): string => {
  if (!verdict.ok) return verdict.reason;
  if (!verdict.archived)
    return `the contract gate passes: the store was switched at ${verdict.switchedAt.toISOString()} and this install never absorbed a custom resource, so it has no archive to attest`;
  return `the contract gate passes: switched at ${verdict.switchedAt.toISOString()}, archive sha256 ${verdict.sha256} attested, ${
    verdict.backupRef === null
      ? "no object store, so the operator's encrypted file is the only copy"
      : `object-store copy ${verdict.backupRef}`
  }`;
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: the contract release's one deletion, decided
 * before it removes anything.
 *
 * The install's marker records the gate it passed, and only a passing gate
 * writes it: so the deletion cannot outrun the archive the rollback window
 * kept. The children are not cascaded — the anchors own them, and a delete
 * that took them would stop every machine — and a second run, or a cluster
 * whose CRDs are already retired, deletes nothing.
 */
export const deleteCrsRefusal = (
  marker: Record<string, string> | null,
): string | null =>
  marker?.[CONTRACT_MARKER_KEY]
    ? null
    : "this install's marker records no passing contract gate (contract-at). Deploy the contract release first: its api-server writes that stamp only once the rollback window has closed and the archive is attested.";

export async function deleteCustomResources(deps: {
  list: (plural: string) => Promise<Array<{ name: string }>>;
  remove: (plural: string, name: string) => Promise<void>;
  dryRun: boolean;
}): Promise<string[]> {
  const removed: string[] = [];
  for (const plural of ["agents", "userbudgets"]) {
    for (const item of await deps.list(plural)) {
      removed.push(`${plural}/${item.name}`);
      if (!deps.dryRun) await deps.remove(plural, item.name);
    }
  }
  return removed;
}
