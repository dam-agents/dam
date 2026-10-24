import { createHash } from "node:crypto";
import {
  controlAgentStore,
  controlAgentStoreExports,
  controlCrdSnapshots,
  eq,
  sql,
  type Db,
} from "db";
import {
  CONTRACT_MARKER_KEY,
  CONTRACT_REHEARSAL_KEY,
  CONTRACT_REHEARSAL_VALUE,
} from "./fence.js";
import { orderDocuments } from "./snapshot.js";

export const CONTRACT_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface ExportedArchive {
  exportedAt: Date;
  recipient: string;
  plaintextSha256: string;
  ciphertextSha256: string;
}

export interface ContractFacts {
  now: Date;
  switchedAt: Date | null;
  emptyArchive: boolean;
  absorbedDocuments: number | null;
  absorbedAgents: number | null;
  absorbedBudgets: number | null;
  documents: number;
  recordedSha256: string | null;
  archiveSha256: string | null;
  backupRef: string | null;
  objectStoreSha256: string | null;
  exported: ExportedArchive | null;
  expectedRecipient: string | null;
  attestedSha256: string | null;
}

export type ContractVerdict =
  | { ok: true; switchedAt: Date; archived: false }
  | {
      ok: true;
      switchedAt: Date;
      archived: true;
      sha256: string;
      backupRef: string | null;
      objectStoreVerified: boolean;
      exportedAt: Date;
      recipient: string;
    }
  | { ok: false; reason: string };

const refused = (reason: string): ContractVerdict => ({ ok: false, reason });

/**
 * UNIT_BOUNDARY_DESCRIPTION: the contract gate, decided before a release stops
 * reading the custom resources the rollback window exists for.
 *
 * The release that deletes an install's custom resources is the first
 * irreversible step, so it refuses on facts instead of trusting its values:
 * the install was switched, the window has closed, the archive the switch
 * stored still reads back to the digest the absorb recorded, the object store
 * answers with those same bytes, an operator exported that archive through the
 * platform, and the digest attesting the export is the one of the encrypted
 * file that left the platform. An install that never absorbed a custom
 * resource has nothing to roll back and says so instead of silencing the same
 * checks.
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
    if (
      input.documents > 0 ||
      input.absorbedDocuments !== 0 ||
      input.absorbedAgents !== 0 ||
      input.absorbedBudgets !== 0
    )
      return refused(
        "this install absorbed custom resources, so it has an archive to export and attest: clear agentStore.contract.emptyArchive and set agentStore.contract.backupSha256 to the export's ciphertext digest instead",
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
      "the snapshot table does not read back to the digest the absorb recorded: the archive is not the one the switch verified, so it is not one to delete the custom resources against",
    );
  if (input.backupRef !== null && input.objectStoreSha256 === null)
    return refused(
      `the absorb recorded an object-store copy (${input.backupRef}) and it does not read back now: the install's second copy is gone, so the operator's file would be the only one`,
    );
  if (
    input.backupRef !== null &&
    input.objectStoreSha256 !== input.recordedSha256
  )
    return refused(
      `the object-store copy ${input.backupRef} does not hold the bytes the absorb recorded: the two copies disagree, so neither is one to delete the custom resources against`,
    );
  if (input.exported === null)
    return refused(
      "no operator export is recorded: run `agent-store-cli export-snapshot` (it writes the encrypted file and records the export) before releasing the contract values",
    );
  if (input.exported.plaintextSha256 !== input.recordedSha256)
    return refused(
      "the recorded export is not of this install's archive: the operator exported another store's documents, or a snapshot the absorb did not write",
    );
  if (
    input.expectedRecipient === null ||
    input.exported.recipient !== input.expectedRecipient
  )
    return refused(
      `the recorded export was encrypted to ${input.exported.recipient}, not to this install's agentStore.backup.recipient: the key holder cannot open it, so it is not the copy D79A asks for`,
    );
  if (input.attestedSha256 === null)
    return refused(
      "the export is not attested: set agentStore.contract.backupSha256 to the ciphertext digest `export-snapshot` printed, taken from the file the key holder keeps",
    );
  if (input.attestedSha256 !== input.exported.ciphertextSha256)
    return refused(
      `the attested digest is not this install's exported file: the record says another ciphertext was written (${input.exported.exportedAt.toISOString()}), so the file the operator holds is a different one`,
    );
  return {
    ok: true,
    switchedAt: input.switchedAt,
    archived: true,
    sha256: input.recordedSha256,
    backupRef: input.backupRef,
    objectStoreVerified: input.backupRef !== null,
    exportedAt: input.exported.exportedAt,
    recipient: input.exported.recipient,
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
  const yaml = documents.map((doc) => doc.yaml).join("---\n");
  return { documents: documents.length, sha256: sha256(yaml), yaml };
}

export async function readContractFacts(
  db: Db,
  input: {
    now: Date;
    attestedSha256: string | null;
    emptyArchive: boolean;
    expectedRecipient: string | null;
    readObject: ((ref: string) => Promise<Buffer | null>) | null;
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
    | {
        backup?: { sha256?: string };
        snapshot?: { documents?: number };
        agents?: { seen?: number; imported?: number };
        budgets?: { seen?: number; imported?: number };
      }
    | null
    | undefined;
  const archive = await readArchive(db);
  const exported = await db
    .select({
      exportedAt: controlAgentStoreExports.exportedAt,
      recipient: controlAgentStoreExports.recipient,
      plaintextSha256: controlAgentStoreExports.plaintextSha256,
      ciphertextSha256: controlAgentStoreExports.ciphertextSha256,
    })
    .from(controlAgentStoreExports)
    .orderBy(sql`${controlAgentStoreExports.exportedAt} DESC`)
    .limit(1);
  const backupRef = rows[0]?.backupRef ?? null;
  const readObject = input.readObject;
  const objectStoreSha256 =
    backupRef === null || readObject === null
      ? null
      : await (async (): Promise<string | null> => {
          const content = await readObject(backupRef);
          return content === null ? null : sha256(content.toString("utf8"));
        })();
  return {
    now: input.now,
    switchedAt: rows[0]?.switchedAt ?? null,
    emptyArchive: input.emptyArchive,
    absorbedDocuments: report?.snapshot?.documents ?? null,
    absorbedAgents: report?.agents?.seen ?? null,
    absorbedBudgets: report?.budgets?.seen ?? null,
    documents: archive?.documents ?? 0,
    recordedSha256: report?.backup?.sha256 ?? null,
    archiveSha256: archive?.sha256 ?? null,
    backupRef,
    objectStoreSha256,
    exported:
      exported[0] === undefined
        ? null
        : {
            exportedAt: exported[0].exportedAt,
            recipient: exported[0].recipient,
            plaintextSha256: exported[0].plaintextSha256,
            ciphertextSha256: exported[0].ciphertextSha256,
          },
    expectedRecipient: input.expectedRecipient,
    attestedSha256: input.attestedSha256,
  };
}

export const describeContract = (verdict: ContractVerdict): string => {
  if (!verdict.ok) return verdict.reason;
  if (!verdict.archived)
    return `the contract gate passes: the store was switched at ${verdict.switchedAt.toISOString()} and this install never absorbed a custom resource, so it has no archive to attest`;
  return `the contract gate passes: switched at ${verdict.switchedAt.toISOString()}, the operator's export of ${verdict.exportedAt.toISOString()} to ${verdict.recipient} is attested, and ${
    verdict.objectStoreVerified
      ? `the object-store copy ${verdict.backupRef} reads back to the same bytes`
      : "no object store is configured, so the operator's encrypted file is the only copy"
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
  options: { now?: Date; rehearsal?: boolean } = {},
): string | null => {
  const contracted = marker?.[CONTRACT_MARKER_KEY];
  if (!contracted)
    return "this install's marker records no passing contract gate (contract-at). Deploy the contract release first: its api-server writes that stamp only once the rollback window has closed and the archive is attested.";
  if (!options.rehearsal) {
    if (marker?.[CONTRACT_REHEARSAL_KEY] === CONTRACT_REHEARSAL_VALUE)
      return "this install's contract gate ran on a rehearsal clock (contract-clock: rehearsal), so its window was not the real one: a rehearsal cluster passes --rehearsal, an install never has one.";
    const at = Date.parse(contracted);
    const now = (options.now ?? new Date()).getTime();
    if (Number.isNaN(at))
      return `the marker's contract-at is not a timestamp: ${contracted}`;
    if (at > now)
      return "the marker's contract-at is in the future: the gate did not run on the real clock, and a window that has not closed is not one to delete custom resources on.";
  }
  return null;
};

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
