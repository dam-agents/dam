// TEST_OVERVIEW: every node signs its gateways' leaves with the install's CA, and an agent trusts the CA the node handed it. Two nodes that each minted their own would leave half the agents unable to verify the other half's gateways, so the only property that matters here is that claiming is a race with exactly one winner and no loser left holding its own key.
import { describe, expect, it } from "vitest";
import type { Db } from "db";
import { createInstallCaStore } from "../../modules/sandboxes/infrastructure/install-ca-store.js";

function fakeDb() {
  const rows = new Map<
    string,
    { name: string; value: Record<string, string> }
  >();
  let conflictHonoured = false;
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([...rows.values()]),
        }),
      }),
    }),
    insert: () => ({
      values: (v: { name: string; value: Record<string, string> }) => ({
        onConflictDoNothing: () => {
          if (rows.has(v.name)) conflictHonoured = true;
          else rows.set(v.name, v);
          return Promise.resolve([]);
        },
      }),
    }),
  };
  return { db: db as unknown as Db, rows, didConflict: () => conflictHonoured };
}

describe("install CA", () => {
  it("reports nothing before anyone has claimed", async () => {
    const { db } = fakeDb();
    await expect(createInstallCaStore(db).load()).resolves.toBeNull();
  });

  // TEST_SCENARIO: two nodes boot together, both find no CA and both generate one; the second must adopt the first's rather than install its own.
  it("gives both claimants the same CA", async () => {
    const { db, didConflict } = fakeDb();
    const first = createInstallCaStore(db);
    const second = createInstallCaStore(db);

    const a = await first.claim({ cert: "CERT-A", key: "KEY-A" });
    const b = await second.claim({ cert: "CERT-B", key: "KEY-B" });

    expect(a).toEqual({ cert: "CERT-A", key: "KEY-A" });
    expect(b).toEqual(a);
    expect(didConflict()).toBe(true);
  });

  it("hands back the stored CA on a later boot", async () => {
    const { db } = fakeDb();
    const store = createInstallCaStore(db);
    await store.claim({ cert: "CERT", key: "KEY" });
    await expect(store.load()).resolves.toEqual({ cert: "CERT", key: "KEY" });
  });
});
