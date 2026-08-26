import { describe, it, expect } from "vitest";
import { createDb, type Db } from "db";
import { reconcileUsageViewGrants } from "../../modules/usage/infrastructure/usage-view-grants.js";
import { reportUsageViewGrants } from "../../modules/usage/infrastructure/usage-view-grants-report.js";
import type { UsageViewGrants } from "../../modules/usage/infrastructure/usage-view-grants.js";
import type { Logger } from "../../core/logger.js";

// TEST_OVERVIEW: The reconcile keeps the usage_readers group's SELECT on the usage_src_* passthroughs current, and must never be able to stop the api-server from starting. It runs on the startup path, issues DCL against a catalog that migrations and operators mutate concurrently, and every error it does not swallow is a CrashLoopBackOff. These specs pin the containment and the reporting split; the SQL itself is exercised against a real Postgres, which this suite has no access to.

type Executed = { text: string; params: unknown[] };

type Dialect = { sqlToQuery: (q: never) => { sql: string; params: unknown[] } };
let dialect: Dialect | undefined;
function renderer(): Dialect {
  if (!dialect) {
    const probe = createDb("postgresql://unused:unused@127.0.0.1:1/unused");
    dialect = (probe.db as unknown as { dialect: Dialect }).dialect;
    void probe.sql.end({ timeout: 0 });
  }
  return dialect;
}

function fakeDb(
  reply: (text: string) => unknown[],
  opts: { failOn?: RegExp } = {},
): { db: Db; executed: Executed[] } {
  const executed: Executed[] = [];
  const execute = (query: unknown) => {
    const { sql: text, params } = renderer().sqlToQuery(query as never);
    executed.push({ text, params });
    if (opts.failOn?.test(text)) {
      return Promise.reject(new Error("boom"));
    }
    return Promise.resolve(reply(text));
  };
  const db = {
    execute,
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({ execute }),
  } as unknown as Db;
  return { db, executed };
}

type CatalogState = {
  locked?: boolean;
  pending?: string[];
  after?: Array<{ name: string; readable: boolean; grantable: boolean }>;
  reach?: { can_connect: boolean; can_use_schema: boolean };
};

const catalogReply =
  (state: CatalogState) =>
  (text: string): unknown[] => {
    if (text.includes("to_regrole")) return [{ present: true }];
    if (text.includes("pg_try_advisory_xact_lock")) {
      return [{ locked: state.locked ?? true }];
    }
    if (text.includes("has_database_privilege")) {
      return [state.reach ?? { can_connect: true, can_use_schema: true }];
    }
    if (text.includes("NOT has_table_privilege")) {
      return (state.pending ?? []).map((name) => ({ name }));
    }
    if (text.includes("COALESCE(has_table_privilege")) return state.after ?? [];
    return [];
  };

function expectDidNotBailEarly(executed: Executed[]): void {
  expect(
    executed.some(
      (e) => e.text.includes("GRANT") || e.text.includes("pg_class"),
    ),
  ).toBe(true);
}

type LogLine = [string, string, Record<string, unknown>];

function collectLogs(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const record = (level: string) => (o: Record<string, unknown>, msg: string) =>
    lines.push([level, msg, o]);
  const logger = {
    info: record("info"),
    warn: record("warn"),
  } as unknown as Logger;
  return { logger, lines };
}

describe("usage view grant reconcile", () => {
  // TEST_SCENARIO: Most installs have no analytics consumer, so the role does not exist. Nothing may be granted and nothing may fail — a missing role is the normal state, not an error.
  it("does nothing and reports absence when the role does not exist", async () => {
    const { db, executed } = fakeDb((text) =>
      text.includes("to_regrole") ? [{ present: false }] : [],
    );

    const result = await reconcileUsageViewGrants(db);

    expect(result.failed).toBeUndefined();
    expect(result.rolePresent).toBe(false);
    expect(result.readable).toEqual([]);
    expect(executed.filter((e) => e.text.includes("GRANT"))).toHaveLength(0);
  });

  // TEST_SCENARIO: A failure anywhere in the reconcile must degrade to a report, never propagate. This runs before the HTTP listener exists, so a rejection here is an api-server that never starts — for an optional analytics grant. The injection is keyed on statement text, so renaming the statement disarms it; the first assertion is there to fail on that rather than leave the scenario silently untested.
  it("never throws when the database rejects, and says it failed", async () => {
    const failOn = /advisory_xact_lock/;
    const { db, executed } = fakeDb(catalogReply({}), { failOn });

    const result = await reconcileUsageViewGrants(db);

    expect(executed.some((e) => failOn.test(e.text))).toBe(true);
    expect(result.failed).toBeDefined();
    expect(result.readable).toEqual([]);
  });

  // TEST_SCENARIO: Only views missing the privilege are granted. Re-granting what is already held writes to the catalog and into the DDL audit log on every boot, for nothing.
  it("grants only the passthroughs that are missing the privilege", async () => {
    const { db, executed } = fakeDb(
      catalogReply({
        pending: ["usage_src_events"],
        after: [
          { name: "usage_src_agents", readable: true, grantable: true },
          { name: "usage_src_events", readable: true, grantable: true },
        ],
      }),
    );

    await reconcileUsageViewGrants(db);

    expectDidNotBailEarly(executed);
    const grants = executed.filter((e) => e.text.includes("GRANT SELECT"));
    expect(grants).toHaveLength(1);
    expect(grants[0]?.text).toContain("usage_src_events");
  });

  // TEST_SCENARIO: A view granted during this run is re-measured afterwards, so it must come back as readable rather than lingering in the alarm set. Reporting a view it just fixed would make the warning that means "a human is needed" fire on the ordinary path.
  it("reports a view it granted as readable, not as an alarm", async () => {
    const { db, executed } = fakeDb(
      catalogReply({
        pending: ["usage_src_events"],
        after: [{ name: "usage_src_events", readable: true, grantable: true }],
      }),
    );

    const result = await reconcileUsageViewGrants(db);

    expectDidNotBailEarly(executed);
    expect(result.granted).toEqual(["usage_src_events"]);
    expect(result.readable).toEqual(["usage_src_events"]);
    expect(result.unreadable).toEqual([]);
    expect(result.notGrantable).toEqual([]);
  });

  // TEST_SCENARIO: Several replicas start at once and only one pass is needed. A replica that does not win the lock must do nothing further — not even read back, because it would see the winner's half-applied state and report it as an alarm — and must not wait, or every replica's startup queues behind the first.
  it("skips the whole pass when another replica holds the lock", async () => {
    const { db, executed } = fakeDb(
      catalogReply({
        locked: false,
        pending: ["usage_src_events"],
        after: [{ name: "usage_src_events", readable: false, grantable: true }],
      }),
    );

    const result = await reconcileUsageViewGrants(db);

    expect(result.skipped).toBe(true);
    expect(result.failed).toBeUndefined();
    expect(executed.some((e) => e.text.includes("GRANT SELECT"))).toBe(false);
    expect(
      executed.some((e) => e.text.includes("COALESCE(has_table_privilege")),
    ).toBe(false);
    expect(result.unreadable).toEqual([]);
  });

  // TEST_SCENARIO: The GRANT must name the schema. Unqualified, it resolves through search_path, which lands the grant on whatever shadows the view — including a table — and can abort the boot.
  it("schema-qualifies every grant", async () => {
    const { db, executed } = fakeDb(
      catalogReply({ pending: ["usage_src_events"] }),
    );

    await reconcileUsageViewGrants(db);

    expectDidNotBailEarly(executed);
    const grant = executed.find((e) => e.text.includes("GRANT SELECT"));
    expect(grant?.text).toMatch(/"public"\."usage_src_events"/);
  });

  // TEST_SCENARIO: A view this role cannot grant is a different problem from one it can: no restart will fix the former. Collapsing them trains the alarm into noise.
  it("separates views it cannot grant from views it granted and still cannot read", async () => {
    const { db } = fakeDb(
      catalogReply({
        after: [
          { name: "usage_src_foreign", readable: false, grantable: false },
          { name: "usage_src_ok", readable: true, grantable: true },
        ],
      }),
    );

    const result = await reconcileUsageViewGrants(db);

    expect(result.failed).toBeUndefined();
    expect(result.notGrantable).toEqual(["usage_src_foreign"]);
    expect(result.unreadable).toEqual([]);
    expect(result.readable).toEqual(["usage_src_ok"]);
  });

  // TEST_SCENARIO: Work is bounded because it blocks startup. Without both timeouts a stalled lock holder or a hung statement keeps every replica from ever becoming ready. The form matters as much as the values: SET LOCAL cannot take a bind parameter, so spelling it that way makes every reconcile fail on the first statement.
  it("bounds the transaction with a lock and statement timeout", async () => {
    const { db, executed } = fakeDb(catalogReply({}));

    await reconcileUsageViewGrants(db);

    expectDidNotBailEarly(executed);
    const text = executed.map((e) => e.text).join("\n");
    expect(text).toContain("set_config('lock_timeout'");
    expect(text).toContain("set_config('statement_timeout'");
    expect(executed.some((e) => e.text.includes("SET LOCAL"))).toBe(false);
  });
});

describe("usage view grant reporting", () => {
  const base: UsageViewGrants = {
    role: "usage_readers",
    rolePresent: true,
    canConnect: true,
    canUseSchema: true,
    skipped: false,
    granted: [],
    readable: ["usage_src_agents"],
    unreadable: [],
    notGrantable: [],
  };

  // TEST_SCENARIO: Each failure mode gets its own event name, so an operator can tell apart the one a restart heals, the one needing a manual GRANT, and the one where the role cannot reach the database at all.
  it("names each outcome distinctly", () => {
    const cases: Array<[Partial<UsageViewGrants>, string, string]> = [
      [{ rolePresent: false }, "info", "usage.grants.role-absent"],
      [{ skipped: true }, "info", "usage.grants.skipped"],
      [{ failed: "boom" }, "warn", "usage.grants.failed"],
      [{ canConnect: false }, "warn", "usage.grants.unreachable"],
      [{ unreadable: ["usage_src_x"] }, "warn", "usage.grants.incomplete"],
      [{ notGrantable: ["usage_src_y"] }, "warn", "usage.grants.not-grantable"],
      [{}, "info", "usage.grants.reconciled"],
    ];

    for (const [patch, level, event] of cases) {
      const { logger, lines } = collectLogs();
      reportUsageViewGrants(logger, { ...base, ...patch });
      expect(lines.map(([lvl, msg]) => [lvl, msg])).toEqual([[level, event]]);
    }
  });

  // TEST_SCENARIO: Both alarm sets can be non-empty at once. Only one line is logged, so whichever name wins must still carry the set that needs an operator — otherwise the case no restart can fix disappears exactly when something else is also wrong.
  it("keeps the operator-actionable set when both alarms are live", () => {
    const { logger, lines } = collectLogs();

    reportUsageViewGrants(logger, {
      ...base,
      unreadable: ["usage_src_x"],
      notGrantable: ["usage_src_y"],
    });

    expect(lines).toHaveLength(1);
    const [level, event, payload] = lines[0] as LogLine;
    expect([level, event]).toEqual(["warn", "usage.grants.incomplete"]);
    expect(payload.unreadable).toEqual(["usage_src_x"]);
    expect(payload.notGrantable).toEqual(["usage_src_y"]);
  });
});
