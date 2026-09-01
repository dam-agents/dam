import { describe, it, expect } from "vitest";
import { createDb, pendingApprovals, type Db } from "db";
import { createApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";

// TEST_OVERVIEW: expireOverdue must compare expires_at through drizzle's column mapper, not a raw sql template. A raw template leaves the JS Date unserialized, and drizzle's postgres-js driver replaces the timestamptz serializer with identity, so the driver throws at bind and the sweep silently expires nothing.

function captureWhereCondition(): { db: Db; taken: () => unknown } {
  let condition: unknown;
  const chain = {
    set: () => chain,
    where: (cond: unknown) => {
      condition = cond;
      return chain;
    },
    returning: () => Promise.resolve([]),
  };
  const db = { update: () => chain } as unknown as Db;
  return { db, taken: () => condition };
}

describe("expireOverdue query building", () => {
  // TEST_SCENARIO: The regression guard — the comparison's bound parameters must all be driver-serializable primitives. A Date object surviving into params is the exact shape that throws at bind and reintroduces the silent no-op.
  it("binds the expiry cutoff as a serialized value, never a raw Date", async () => {
    const { db, taken } = captureWhereCondition();
    const repo = createApprovalsRepository(db);

    await repo.expireOverdue(new Date("2026-01-02T03:04:05.000Z"));

    const condition = taken();
    expect(condition).toBeDefined();

    const render = createDb("postgresql://unused:unused@127.0.0.1:1/unused");
    const { params } = render.db
      .select({ id: pendingApprovals.id })
      .from(pendingApprovals)
      .where(condition as never)
      .toSQL();
    void render.sql.end({ timeout: 0 });

    expect(params.some((p) => p instanceof Date)).toBe(false);
    expect(params).toContain("2026-01-02T03:04:05.000Z");
  });
});
