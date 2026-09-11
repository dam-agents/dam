// TEST_OVERVIEW: the secret store holds the credential bytes an agent's gateway injects, so the two things that must hold are that a ref cannot address a row it was not minted for, and that writing one field never drops the others. Both are cheap to break and expensive to notice: the first leaks across owners, the second silently empties a connection.
import { describe, expect, it } from "vitest";
import type { Db } from "db";
import { createPgSecretStore } from "../../modules/secret-store/infrastructure/pg-secret-store.js";

interface Recorded {
  op: string;
  set?: Record<string, unknown>;
  values?: Record<string, unknown>;
  conflict?: unknown;
}

function fakeDb(rowsForUpdate: unknown[] = [{ path: "p" }]) {
  const calls: Recorded[] = [];
  const chain = (rec: Recorded, result: unknown[]): unknown => {
    const self: Record<string, unknown> = {};
    for (const m of [
      "from",
      "where",
      "limit",
      "returning",
      "onConflictDoUpdate",
    ]) {
      self[m] = (arg: unknown) => {
        if (m === "onConflictDoUpdate") rec.conflict = arg;
        return self;
      };
    }
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(result).then(resolve);
    return self;
  };
  const db = {
    select: () => chain(record("select"), []),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        const rec = record("insert");
        rec.values = values;
        return chain(rec, []);
      },
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => {
        const rec = record("update");
        rec.set = set;
        return chain(rec, rowsForUpdate);
      },
    }),
    delete: () => chain(record("delete"), []),
  };
  function record(op: string): Recorded {
    const rec: Recorded = { op };
    calls.push(rec);
    return rec;
  }
  return { db: db as unknown as Db, calls };
}

const store = (rows?: unknown[]) => {
  const { db, calls } = fakeDb(rows);
  return { store: createPgSecretStore({ db }), calls };
};

describe("ref minting", () => {
  // TEST_SCENARIO: the owner is a Keycloak sub, but the path is built from it — an owner carrying separators must collapse to one segment rather than becoming several.
  it("escapes an owner that would otherwise steer the path", async () => {
    const { store: s } = store();
    const ref = s.mintRef({ owner: "../../etc", purpose: "anthropic" });
    const segments = ref.path.split("/");
    expect(segments).toHaveLength(2);
    expect(segments).not.toContain("..");
    expect(ref.storeId).toBe("pg");
    await expect(s.get(ref)).resolves.toBeNull();
  });

  it("gives two secrets of one owner and purpose distinct paths", () => {
    const { store: s } = store();
    const meta = { owner: "kc|u1", purpose: "anthropic" };
    expect(s.mintRef(meta).path).not.toBe(s.mintRef(meta).path);
  });
});

// TEST_SCENARIO: refs arrive from connection rows, which are user-influenced; a path that is not exactly `<owner>/<name>` must never reach a query.
describe("ref validation", () => {
  const malformed = ["", "no-slash", "a/b/c", "../escape", "own er/x", "a/"];

  it("refuses a malformed path on every read and write", async () => {
    const { store: s, calls } = store();
    for (const path of malformed) {
      await expect(s.get({ storeId: "pg", path })).rejects.toThrow(/malformed/);
      await expect(s.delete({ storeId: "pg", path })).rejects.toThrow(
        /malformed/,
      );
      await expect(
        s.putField({ storeId: "pg", path, field: "k" }, "v"),
      ).rejects.toThrow(/malformed/);
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses a ref minted by a different store", async () => {
    const { store: s } = store();
    await expect(s.get({ storeId: "file", path: "o/n" })).rejects.toThrow(
      /cannot handle ref/,
    );
  });
});

describe("writes", () => {
  // TEST_SCENARIO: putField setting `fields` to a plain object would discard every other field — a connection loses its refresh token the first time its access token is renewed.
  it("merges a single field instead of replacing the set", async () => {
    const { store: s, calls } = store();
    await s.putField({ storeId: "pg", path: "o/n", field: "access" }, "v");
    const update = calls.find((c) => c.op === "update");
    expect(update).toBeDefined();
    expect(update!.set!.fields).toHaveProperty("queryChunks");
  });

  it("fails loudly when the secret does not exist yet", async () => {
    const { store: s } = store([]);
    await expect(
      s.putFields({ storeId: "pg", path: "o/n", field: "" }, { a: "b" }),
    ).rejects.toThrow(/does not exist/);
  });

  it("upserts on put, so re-putting a ref does not duplicate the row", async () => {
    const { store: s, calls } = store();
    await s.put(
      { storeId: "pg", path: "o/n", field: "" },
      { a: "b" },
      {
        owner: "o",
        purpose: "anthropic",
      },
    );
    const insert = calls.find((c) => c.op === "insert");
    expect(insert!.conflict).toBeDefined();
    expect(insert!.values).toMatchObject({ owner: "o", purpose: "anthropic" });
  });
});
