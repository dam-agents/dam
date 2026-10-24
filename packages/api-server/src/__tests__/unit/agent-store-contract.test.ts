import { describe, expect, it } from "vitest";
import {
  CONTRACT_WINDOW_DAYS,
  contractVerdict,
  deleteCrsRefusal,
  deleteCustomResources,
  type ContractFacts,
} from "../../modules/agent-store/contract.js";
import {
  CONTRACT_MARKER_KEY,
  CONTRACT_REHEARSAL_KEY,
  CONTRACT_REHEARSAL_VALUE,
} from "../../modules/agent-store/fence.js";

// TEST_OVERVIEW: The contract release is the first irreversible step of the move: it stops reading the custom resources the one-week rollback window keeps. The gate must refuse every install that has not stood the window, has no archive, has an archive that no longer reads back, has an object-store copy that disagrees, has no recorded operator export, exported to another key, or attested a file that is not the exported one — and the deletion that follows it must refuse without a real-clock gate, a rehearsal clock, or a future stamp, and delete nothing the second time.

const SWITCHED = new Date("2026-10-01T00:00:00Z");
const PLAINTEXT = "a".repeat(64);
const CIPHERTEXT = "b".repeat(64);
const LATER = new Date(
  SWITCHED.getTime() + (CONTRACT_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1_000,
);
const RECIPIENT = "age1installexample";

const facts = (over: Partial<ContractFacts> = {}): ContractFacts => ({
  now: LATER,
  switchedAt: SWITCHED,
  emptyArchive: false,
  absorbedDocuments: 3,
  absorbedAgents: 3,
  absorbedBudgets: 0,
  documents: 3,
  recordedSha256: PLAINTEXT,
  archiveSha256: PLAINTEXT,
  backupRef: "s3://platform-artifacts/crd-snapshots/platform/aaa.yaml",
  objectStoreSha256: PLAINTEXT,
  exported: {
    exportedAt: new Date("2026-10-02T00:00:00Z"),
    recipient: RECIPIENT,
    plaintextSha256: PLAINTEXT,
    ciphertextSha256: CIPHERTEXT,
  },
  expectedRecipient: RECIPIENT,
  attestedSha256: CIPHERTEXT,
  ...over,
});

describe("the contract gate", () => {
  // TEST_SCENARIO: An install that was never switched has no window to respect and no archive to keep: the contract release is the release after a cutover, so it refuses rather than guess.
  it("refuses a store that was never switched", () => {
    const verdict = contractVerdict(facts({ switchedAt: null }));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain("never switched");
  });

  // TEST_SCENARIO: The window is the whole point of the release: one day inside it, the frozen custom resources are still the only copy a rollback restores from, so the release refuses and says how long is left.
  it("refuses every day inside the rollback window", () => {
    for (const days of [0, 1, 6]) {
      const now = new Date(SWITCHED.getTime() + days * 24 * 60 * 60 * 1_000);
      const verdict = contractVerdict(facts({ now }));
      expect(verdict.ok, `day ${days}`).toBe(false);
      expect(verdict.ok === false && verdict.reason).toContain(
        "rollback window",
      );
    }
    expect(
      contractVerdict(
        facts({
          now: new Date(
            SWITCHED.getTime() + CONTRACT_WINDOW_DAYS * 24 * 60 * 60 * 1_000,
          ),
        }),
      ).ok,
    ).toBe(true);
  });

  // TEST_SCENARIO: The switch's archive can be lost or rewritten while the window passes. The gate re-reads the snapshot table and compares it to the digest the absorb recorded, so a release does not delete the custom resources against an archive no longer there.
  it("refuses an archive the database no longer holds", () => {
    for (const over of [
      { recordedSha256: null },
      { archiveSha256: null },
      { archiveSha256: "c".repeat(64) },
    ]) {
      const verdict = contractVerdict(facts(over));
      expect(verdict.ok).toBe(false);
      expect(verdict.ok === false && verdict.reason).toMatch(/archive/);
    }
  });

  // TEST_SCENARIO: The object-store copy is the install's second copy. A copy that no longer reads back, or that reads back as other bytes, is not a copy: the gate refuses rather than fall back on the database.
  it("refuses an object-store copy that is gone or different", () => {
    for (const over of [
      { objectStoreSha256: null },
      { objectStoreSha256: "d".repeat(64) },
    ]) {
      const verdict = contractVerdict(facts(over));
      expect(verdict.ok).toBe(false);
      expect(verdict.ok === false && verdict.reason).toMatch(
        /object-store copy/,
      );
    }
    expect(contractVerdict(facts({ objectStoreSha256: null })).ok).toBe(false);
  });

  // TEST_SCENARIO: D79A makes the operator's encrypted file mandatory. The gate therefore needs the export the platform recorded — its recipient, its plaintext digest and its ciphertext digest — not just a digest pasted from a log.
  it("refuses without a recorded export, with another recipient, or with an unattested file", () => {
    const missing = contractVerdict(facts({ exported: null }));
    expect(missing.ok).toBe(false);
    expect(missing.ok === false && missing.reason).toContain(
      "no operator export",
    );
    const otherKey = contractVerdict(facts({ expectedRecipient: "age1other" }));
    expect(otherKey.ok).toBe(false);
    expect(otherKey.ok === false && otherKey.reason).toContain("key holder");
    const notAttested = contractVerdict(facts({ attestedSha256: null }));
    expect(notAttested.ok).toBe(false);
    expect(notAttested.ok === false && notAttested.reason).toContain(
      "not attested",
    );
    const wrongFile = contractVerdict(
      facts({ attestedSha256: "e".repeat(64) }),
    );
    expect(wrongFile.ok).toBe(false);
    expect(wrongFile.ok === false && wrongFile.reason).toContain(
      "not this install's exported file",
    );
  });

  // TEST_SCENARIO: The export is of the archive the switch absorbed, not of whatever the snapshot table held when someone ran the command: an export of other documents is refused even when its own digests agree.
  it("refuses an export of another archive", () => {
    const verdict = contractVerdict(
      facts({
        exported: {
          ...facts().exported!,
          plaintextSha256: "f".repeat(64),
          ciphertextSha256: CIPHERTEXT,
        },
      }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain(
      "not of this install's archive",
    );
  });

  // TEST_SCENARIO: A refusal is read by whoever is on call, and a message that prints the expected digest hands them the attestation the export exists to prove. The reasons name what is missing, never the value.
  it("never prints the digest the operator is supposed to produce", () => {
    for (const over of [
      { exported: null },
      { attestedSha256: null },
      { archived: true, exported: null } as Partial<ContractFacts>,
    ]) {
      const verdict = contractVerdict(facts(over));
      expect(verdict.ok).toBe(false);
      const reason = verdict.ok === false ? verdict.reason : "";
      expect(reason).not.toContain(PLAINTEXT);
      expect(reason).not.toContain(CIPHERTEXT);
    }
  });

  // TEST_SCENARIO: An install with no object store has only the operator's file, so the same attestation is the whole gate; the verdict names which copy it stands on.
  it("passes on the operator's file alone, and names the copy", () => {
    const verdict = contractVerdict(
      facts({ backupRef: null, objectStoreSha256: null }),
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.ok && verdict.archived && verdict.objectStoreVerified).toBe(
      false,
    );
  });

  // TEST_SCENARIO: An install created after the CRDs were retired never absorbed a resource. It says so instead of attesting an export of nothing, and the gate refuses that claim if the store holds documents, agents or budgets — a lost snapshot table cannot pass as "never had anything".
  it("says so instead of attesting when there was nothing to archive", () => {
    const empty = contractVerdict(
      facts({
        emptyArchive: true,
        documents: 0,
        absorbedDocuments: 0,
        absorbedAgents: 0,
        absorbedBudgets: 0,
        recordedSha256: null,
        archiveSha256: null,
        backupRef: null,
        objectStoreSha256: null,
        exported: null,
        attestedSha256: null,
      }),
    );
    expect(empty.ok).toBe(true);
    expect(empty.ok && empty.archived).toBe(false);
    for (const over of [
      { documents: 1 },
      { absorbedDocuments: null },
      { absorbedAgents: 2 },
      { absorbedBudgets: 1 },
    ]) {
      const lie = contractVerdict(
        facts({ emptyArchive: true, documents: 0, ...over }),
      );
      expect(lie.ok, JSON.stringify(over)).toBe(false);
      expect(lie.ok === false && lie.reason).toContain("emptyArchive");
    }
  });
});

describe("the contract release's CR deletion", () => {
  const marker = (over: Record<string, string> = {}) => ({
    store: "postgres",
    [CONTRACT_MARKER_KEY]: "2026-10-08T00:00:00Z",
    ...over,
  });

  // TEST_SCENARIO: The marker's contract-at is the record of a gate that passed on this install; without it the custom resources are still the copy the window keeps, so nothing is deleted.
  it("refuses without a recorded passing gate", () => {
    expect(deleteCrsRefusal(null)).toBeTruthy();
    expect(deleteCrsRefusal({ store: "postgres" })).toContain("contract-at");
    expect(
      deleteCrsRefusal(marker(), { now: new Date("2026-10-20") }),
    ).toBeNull();
  });

  // TEST_SCENARIO: A rehearsal moves the gate's clock forward, and a stamp it wrote must never authorise a real deletion: a marker that says so, or one dated after the real clock, is refused unless the operator says they are on a rehearsal cluster.
  it("refuses a rehearsal clock and a stamp in the future", () => {
    const rehearsal = marker({
      [CONTRACT_REHEARSAL_KEY]: CONTRACT_REHEARSAL_VALUE,
    });
    expect(deleteCrsRefusal(rehearsal)).toContain("rehearsal clock");
    expect(deleteCrsRefusal(rehearsal, { rehearsal: true })).toBeNull();
    const future = marker({ [CONTRACT_MARKER_KEY]: "2026-12-01T00:00:00Z" });
    expect(
      deleteCrsRefusal(future, { now: new Date("2026-10-24T00:00:00Z") }),
    ).toContain("in the future");
    expect(
      deleteCrsRefusal(future, {
        now: new Date("2026-10-24T00:00:00Z"),
        rehearsal: true,
      }),
    ).toBeNull();
  });

  // TEST_SCENARIO: The deletion runs twice in an operator's hands: once to a dry run, once for real, and again after a partial failure. A rerun must find nothing, and the dry run must remove nothing.
  it("deletes once and is a no-op afterwards", async () => {
    const present: Record<string, string[]> = {
      agents: ["agent-a", "agent-b"],
      userbudgets: ["budget-owner"],
    };
    const deleted: string[] = [];
    const deps = {
      dryRun: false,
      list: async (plural: string) =>
        (present[plural] ?? []).map((name) => ({ name })),
      remove: async (plural: string, name: string) => {
        deleted.push(`${plural}/${name}`);
        present[plural] = (present[plural] ?? []).filter(
          (each) => each !== name,
        );
      },
    };
    expect(await deleteCustomResources({ ...deps, dryRun: true })).toHaveLength(
      3,
    );
    expect(deleted).toHaveLength(0);
    expect(await deleteCustomResources(deps)).toEqual([
      "agents/agent-a",
      "agents/agent-b",
      "userbudgets/budget-owner",
    ]);
    expect(await deleteCustomResources(deps)).toEqual([]);
    expect(deleted).toHaveLength(3);
  });
});
