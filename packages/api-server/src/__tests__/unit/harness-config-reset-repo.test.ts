// TEST_OVERVIEW: the storage behind the one-off permission-mode reset. It freezes the cohort — the pass's own row and the eligible Agents — in one transaction, reads the Agents of it that are still pending, and settles each inside the transaction that queues its correction. The SQL runs against a real Postgres nowhere in this suite, so these specs pin the conditions and the statements.
import { describe, it, expect } from "vitest";
import { createDb, type Db } from "db";
import { createHarnessConfigResetRepo } from "../../modules/harness-config/infrastructure/reset-repo.js";

type Dialect = { sqlToQuery: (q: never) => { sql: string; params: unknown[] } };
type Statement = { sql: string; params: unknown[] };

const RESET = {
  reset: "ibm-litellm-bypass-mode",
  template: "ibm-litellm",
  harness: "claude-code",
  from: "bypassPermissions",
};

function capturingDb(rows: unknown[][] = []) {
  const probe = createDb("postgresql://unused:unused@127.0.0.1:1/unused");
  const dialect = (probe.db as unknown as { dialect: Dialect }).dialect;
  void probe.sql.end({ timeout: 0 });
  const captured: Statement[] = [];
  const execute = (query: unknown) => {
    captured.push(dialect.sqlToQuery(query as never));
    return Promise.resolve(rows.shift() ?? []);
  };
  const db = {
    execute,
    transaction: (work: (tx: unknown) => unknown) =>
      work({ execute, transaction: undefined }),
  } as unknown as Db;
  return { db, captured };
}

describe("harness-config reset repo", () => {
  // TEST_SCENARIO: the cohort is fixed before any Agent is processed, so the pass's own row and the Agents it selected are written in one transaction; the second boot that finds the row inserted does not extend the cohort.
  it("freezes the cohort in one transaction", async () => {
    const { db, captured } = capturingDb([[{ agent_id: "*" }], []]);
    const repo = createHarnessConfigResetRepo({ db, ...RESET });

    expect(await repo.roster()).toBe(true);

    expect(captured[0]?.sql).toMatch(
      /INSERT INTO harness_config_resets \(reset, agent_id, settled_at\)/,
    );
    expect(captured[0]?.sql).toContain("ON CONFLICT DO NOTHING");
    expect(captured[0]?.params).toEqual([RESET.reset, "*"]);
    expect(captured[1]?.sql).toContain("connection_grants");
    expect(captured[1]?.sql).toContain("a.deleted_at IS NULL");
    expect(captured[1]?.sql).toContain("harnesses");
    expect(captured[1]?.params).toEqual(
      expect.arrayContaining([
        RESET.reset,
        RESET.template,
        RESET.harness,
        RESET.from,
      ]),
    );
    expect(captured[1]?.sql).toContain("ON CONFLICT DO NOTHING");
  });

  // TEST_SCENARIO: an Agent created, granted the Connection or set to Bypass after the cohort was frozen is never eligible, because a second pass only reports the cohort's pending Agents and adds nothing to it.
  it("adds nothing to a cohort another boot froze", async () => {
    const { db, captured } = capturingDb([[]]);
    const repo = createHarnessConfigResetRepo({ db, ...RESET });

    expect(await repo.roster()).toBe(false);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.sql).toMatch(/INSERT INTO harness_config_resets/);
  });

  // TEST_SCENARIO: only an Agent of the cohort that is not settled yet is pending, and the cursor makes the run pageable with a bounded query.
  it("reads the cohort's pending Agents a page at a time", async () => {
    const { db, captured } = capturingDb([[{ agent_id: "a2" }]]);
    const repo = createHarnessConfigResetRepo({ db, ...RESET });

    expect(await repo.pending({ after: "a1", limit: 25 })).toEqual(["a2"]);

    const [statement] = captured;
    expect(statement?.sql).toMatch(
      /SELECT agent_id FROM harness_config_resets/,
    );
    expect(statement?.sql).toContain("settled_at IS NULL");
    expect(statement?.sql).toContain("agent_id > $");
    expect(statement?.sql).toContain("ORDER BY agent_id");
    expect(statement?.params).toEqual([RESET.reset, "*", "a1", 25]);
  });

  // TEST_SCENARIO: the claim is conditional on the Agent still being pending and is written in the caller's transaction, so a boot that reads a stale pending list settles nothing a second time, and the claim rolls back with a correction that did not commit.
  it("claims a pending Agent inside the caller's transaction", async () => {
    const { db, captured } = capturingDb([[{ agent_id: "a1" }], []]);
    const repo = createHarnessConfigResetRepo({ db, ...RESET });
    const tx = {
      execute: (query: Parameters<Db["execute"]>[0]) => db.execute(query),
    } as unknown as Db;

    expect(await repo.claim("a1", tx)).toBe(true);
    expect(await repo.claim("a1", tx)).toBe(false);

    expect(captured[0]?.sql).toMatch(
      /UPDATE harness_config_resets SET settled_at = now\(\)/,
    );
    expect(captured[0]?.sql).toContain("settled_at IS NULL");
    expect(captured[0]?.sql).toContain("RETURNING agent_id");
    expect(captured[0]?.params).toEqual([RESET.reset, "a1"]);
  });

  // TEST_SCENARIO: the pass's own row is what makes the reset once, so it is also what says the cohort is frozen.
  it("reports a frozen cohort", async () => {
    const { db, captured } = capturingDb([[{ "?column?": 1 }], []]);
    const repo = createHarnessConfigResetRepo({ db, ...RESET });

    expect(await repo.frozen()).toBe(true);

    expect(captured[0]?.sql).toMatch(/SELECT 1 FROM harness_config_resets/);
    expect(captured[0]?.params).toEqual([RESET.reset, "*"]);
  });
});
