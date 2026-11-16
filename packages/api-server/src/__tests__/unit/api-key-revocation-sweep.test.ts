import { describe, expect, it, vi } from "vitest";

import {
  createKeyRevocationSweep,
  KEY_REVOCATION_GRACE_SECONDS,
} from "../../modules/api-keys/services/key-revocation-sweep.js";

/**
 * TEST_OVERVIEW: the sweep that settles the key ledger. A queued key is a key a
 * create or a rotation is about to make a Connection's, so the sweep reads only
 * entries older than a grace window and leaves the rest alone; an entry that
 * outlives it names a key nothing adopted, and is revoked. An entry a Connection
 * does name is dropped instead, so a crash between the Connection's write and
 * the ledger's settle costs the entry, not the key.
 */
function harness(
  entries: { keyId: string; ownerSub: string; ageSec: number }[],
) {
  const revoked: string[] = [];
  const dropped: string[] = [];
  const named = new Set<string>();
  const sweep = createKeyRevocationSweep({
    pending: async (olderThanSeconds) =>
      entries
        .filter((e) => e.ageSec >= olderThanSeconds)
        .map(({ keyId, ownerSub }) => ({ keyId, ownerSub })),
    revoke: async (keyId) => void revoked.push(keyId),
    namedByAConnection: async (keyId) => named.has(keyId),
    drop: async (keyId) => void dropped.push(keyId),
  });
  return { sweep, revoked, dropped, named };
}

describe("the key revocation sweep", () => {
  // TEST_SCENARIO: a create has queued its key and not yet written the Connection's row, so the entry is inside the grace window and the sweep must not touch it — the create then finishes, and its key goes on working.
  it("leaves a key a create is still adopting alone", async () => {
    const w = harness([{ keyId: "key-fresh", ownerSub: "alice", ageSec: 2 }]);
    expect(await w.sweep.run()).toBe(0);
    expect(w.revoked).toEqual([]);
    expect(w.dropped).toEqual([]);
  });

  // TEST_SCENARIO: an entry that outlived the grace window names a key nothing adopted — a create or rotation that gave up — so the sweep revokes it and settles the entry.
  it("revokes a key nothing adopted once the window has passed", async () => {
    const w = harness([
      {
        keyId: "key-abandoned",
        ownerSub: "alice",
        ageSec: KEY_REVOCATION_GRACE_SECONDS + 60,
      },
    ]);
    expect(await w.sweep.run()).toBe(1);
    expect(w.revoked).toEqual(["key-abandoned"]);
    expect(w.dropped).toEqual(["key-abandoned"]);
  });

  // TEST_SCENARIO: a Connection does name the key — the ledger's settle never ran — so the sweep drops the entry and keeps the key, which is the credential that Connection works with.
  it("keeps a key a Connection names, and drops its entry", async () => {
    const w = harness([
      {
        keyId: "key-adopted",
        ownerSub: "alice",
        ageSec: KEY_REVOCATION_GRACE_SECONDS + 60,
      },
    ]);
    w.named.add("key-adopted");
    expect(await w.sweep.run()).toBe(0);
    expect(w.revoked).toEqual([]);
    expect(w.dropped).toEqual(["key-adopted"]);
  });

  // TEST_SCENARIO: the window is longer than any create or rotation takes, so a slow one is still inside it.
  it("reads only entries past a window of minutes", async () => {
    const pending = vi.fn(async () => []);
    const sweep = createKeyRevocationSweep({
      pending,
      revoke: async () => {},
      namedByAConnection: async () => false,
      drop: async () => {},
    });
    await sweep.run();
    expect(pending).toHaveBeenCalledWith(KEY_REVOCATION_GRACE_SECONDS);
    expect(KEY_REVOCATION_GRACE_SECONDS).toBeGreaterThanOrEqual(120);
  });
});
