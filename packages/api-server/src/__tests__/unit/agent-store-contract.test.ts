import { describe, expect, it } from "vitest";
import {
  CONTRACT_WINDOW_DAYS,
  contractVerdict,
  deleteCrsRefusal,
  deleteCustomResources,
  type ContractFacts,
} from "../../modules/agent-store/contract.js";
import { CONTRACT_MARKER_KEY } from "../../modules/agent-store/fence.js";

// TEST_OVERVIEW: The contract release is the first irreversible step of the move: it stops reading the custom resources the one-week rollback window keeps. The gate must refuse every install that has not stood the window, has no archive, has an archive that no longer reads back to the recorded digest, or has one the operator did not attest — and the deletion that follows it must refuse without a passing gate and delete nothing the second time.

const SWITCHED = new Date("2026-10-01T00:00:00Z");
const DIGEST = "a".repeat(64);
const LATER = new Date(
  SWITCHED.getTime() + (CONTRACT_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1_000,
);

const facts = (over: Partial<ContractFacts> = {}): ContractFacts => ({
  now: LATER,
  switchedAt: SWITCHED,
  documents: 3,
  recordedSha256: DIGEST,
  archiveSha256: DIGEST,
  backupRef: "s3://platform-artifacts/crd-snapshots/platform/aaa.yaml",
  attestedSha256: DIGEST,
  emptyArchive: false,
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
      { archiveSha256: "b".repeat(64) },
    ]) {
      const verdict = contractVerdict(facts(over));
      expect(verdict.ok).toBe(false);
      expect(verdict.ok === false && verdict.reason).toMatch(/archive/);
    }
  });

  // TEST_SCENARIO: The operator's encrypted file is the copy that leaves the platform, so the operator's digest is the attestation that the archive still exists outside it. A missing or different digest is a refusal, not a warning.
  it("refuses an unattested or mismatched operator archive", () => {
    const missing = contractVerdict(facts({ attestedSha256: null }));
    expect(missing.ok).toBe(false);
    expect(missing.ok === false && missing.reason).toContain("attested");
    const mismatched = contractVerdict(
      facts({ attestedSha256: "c".repeat(64) }),
    );
    expect(mismatched.ok).toBe(false);
    expect(mismatched.ok === false && mismatched.reason).toContain(
      "s3://platform-artifacts",
    );
  });

  // TEST_SCENARIO: An install with no object store has only the operator's file, so the same attestation is the whole gate; the verdict names which copy it stands on.
  it("passes on the operator's file alone, and names the copy", () => {
    const verdict = contractVerdict(facts({ backupRef: null }));
    expect(verdict.ok).toBe(true);
    expect(verdict.ok && verdict.archived && verdict.backupRef).toBeNull();
  });

  // TEST_SCENARIO: An install created after the CRDs were retired never absorbed a resource. It says so instead of attesting a digest of nothing, and the gate refuses that claim if the database does hold documents.
  it("says so instead of attesting when there was nothing to archive", () => {
    const empty = contractVerdict(
      facts({ emptyArchive: true, documents: 0, recordedSha256: null }),
    );
    expect(empty.ok).toBe(true);
    expect(empty.ok && empty.archived).toBe(false);
    const lie = contractVerdict(facts({ emptyArchive: true }));
    expect(lie.ok).toBe(false);
    expect(lie.ok === false && lie.reason).toContain("emptyArchive");
  });
});

describe("the contract release's CR deletion", () => {
  // TEST_SCENARIO: The marker's contract-at is the record of a gate that passed on this install; without it the custom resources are still the copy the window keeps, so nothing is deleted.
  it("refuses without a recorded passing gate", () => {
    expect(deleteCrsRefusal(null)).toBeTruthy();
    expect(deleteCrsRefusal({ store: "postgres" })).toBeTruthy();
    expect(deleteCrsRefusal({ store: "postgres" })).toContain("contract-at");
    expect(
      deleteCrsRefusal({
        store: "postgres",
        [CONTRACT_MARKER_KEY]: "2026-10-08T00:00:00Z",
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
