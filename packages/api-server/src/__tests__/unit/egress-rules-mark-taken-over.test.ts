// TEST_OVERVIEW: the startup sweep marks a connection row that took a trusted preset row over before preset_source existed, so revoking the Connection hands the row back instead of revoking the trusted allow. A takeover keeps its seed batch's decided_at; that batch must still be found after a preset re-apply revoked it, and the agent must still be on the trusted preset. The SQL runs against a real Postgres nowhere in this suite, so these specs pin the conditions the statement carries.
import { describe, it, expect } from "vitest";
import { createDb, type Db } from "db";
import { createEgressRulesRepository } from "../../modules/egress-rules/infrastructure/egress-rules-repository.js";

type Dialect = { sqlToQuery: (q: never) => { sql: string; params: unknown[] } };

function capturingDb(): { db: Db; statements: () => string[] } {
  const probe = createDb("postgresql://unused:unused@127.0.0.1:1/unused");
  const dialect = (probe.db as unknown as { dialect: Dialect }).dialect;
  void probe.sql.end({ timeout: 0 });
  const statements: string[] = [];
  const db = {
    execute: (query: unknown) => {
      statements.push(dialect.sqlToQuery(query as never).sql);
      return Promise.resolve([]);
    },
  } as unknown as Db;
  return { db, statements: () => statements };
}

function subqueries(statement: string): string[] {
  return statement
    .split(/EXISTS \(/)
    .slice(1)
    .map((s) => s.slice(0, s.indexOf(")")));
}

describe("markSeededConnectionRows", () => {
  // TEST_SCENARIO: a preset re-apply revokes the old batch and re-stamps the survivors; the taken-over row keeps the old batch's time, so the batch match must read revoked rows too.
  it("finds the seed batch whatever its rows' status", async () => {
    const { db, statements } = capturingDb();
    await createEgressRulesRepository(db).markSeededConnectionRows(
      ["api.anthropic.com"],
      "preset:trusted",
    );

    const batch = subqueries(statements()[0]!).find((s) =>
      s.includes("decided_at"),
    );
    expect(batch).toBeDefined();
    expect(batch).not.toMatch(/status/);
  });

  // TEST_SCENARIO: an agent moved to preset none or all since its takeover; handing its row back to the trusted preset would allow what it no longer allows.
  it("marks rows only of agents on the trusted preset now", async () => {
    const { db, statements } = capturingDb();
    await createEgressRulesRepository(db).markSeededConnectionRows(
      ["api.anthropic.com"],
      "preset:trusted",
    );

    const current = subqueries(statements()[0]!).find(
      (s) => !s.includes("decided_at"),
    );
    expect(current).toMatch(/status = 'active'/);
    expect(current).toMatch(/source = \$\d+/);
  });

  it("does nothing without trusted hosts", async () => {
    const { db, statements } = capturingDb();
    expect(
      await createEgressRulesRepository(db).markSeededConnectionRows(
        [],
        "preset:trusted",
      ),
    ).toBe(0);
    expect(statements()).toEqual([]);
  });
});
