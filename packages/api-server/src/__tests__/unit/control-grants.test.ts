import { describe, it, expect } from "vitest";
import { createDb, type Db } from "db";
import {
  CONTROL_GRANTS,
  reconcileControlGrants,
} from "../../modules/agent-store/infrastructure/control-grants.js";
import { reportControlGrants } from "../../modules/agent-store/infrastructure/control-grants-report.js";
import type { ControlGrants } from "../../modules/agent-store/infrastructure/control-grants.js";
import type { Logger } from "../../core/logger.js";

// TEST_OVERVIEW: The controller's grants are what confines it to the columns it reconciles, and they live in application code, so the statements this reconcile emits are the security contract. These specs pin that contract — which tables, which columns, and which surfaces stay unreachable — and the containment that keeps a grant failure from stopping the api-server. The privileges themselves only exist on a real Postgres, which this suite has no access to; `mise run //packages/api-server:test:control-grants` exercises them there.

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

type State = {
  present?: boolean;
  locked?: boolean;
  missingColumns?: string[];
  missingTable?: boolean;
};

const catalogReply =
  (state: State) =>
  (text: string): unknown[] => {
    if (text.includes("to_regrole"))
      return [{ present: state.present ?? true }];
    if (text.includes("pg_try_advisory_xact_lock")) {
      return [{ locked: state.locked ?? true }];
    }
    if (text.includes("has_schema_privilege"))
      return [{ can_use_schema: true }];
    if (text.includes("has_column_privilege")) {
      return (state.missingColumns ?? []).map((name) => ({ name }));
    }
    if (text.includes("has_table_privilege")) {
      return [{ allowed: !state.missingTable }];
    }
    return [];
  };

const grants = (executed: Executed[]): string[] =>
  executed.filter((e) => e.text.includes("GRANT")).map((e) => e.text);

describe("control grant reconcile", () => {
  // TEST_SCENARIO: An install that runs no Postgres-backed controller — every install on this release — has no such role. Nothing may be granted and nothing may fail.
  it("does nothing and reports absence when the role does not exist", async () => {
    const { db, executed } = fakeDb(catalogReply({ present: false }));

    const result = await reconcileControlGrants(db);

    expect(result.failed).toBeUndefined();
    expect(result.rolePresent).toBe(false);
    expect(grants(executed)).toEqual([]);
  });

  // TEST_SCENARIO: A failure anywhere must degrade to a report. This runs before the HTTP listener exists, so a rejection here is an api-server that never starts.
  it("never throws when the database rejects, and says it failed", async () => {
    const failOn = /advisory_xact_lock/;
    const { db, executed } = fakeDb(catalogReply({}), { failOn });

    const result = await reconcileControlGrants(db);

    expect(executed.some((e) => failOn.test(e.text))).toBe(true);
    expect(result.failed).toBeDefined();
    expect(result.granted).toEqual([]);
  });

  // TEST_SCENARIO: Several replicas start at once and one pass is enough. A replica that loses the lock must grant nothing rather than race the winner's DCL, and must not wait.
  it("skips the whole pass when another replica holds the lock", async () => {
    const { db, executed } = fakeDb(catalogReply({ locked: false }));

    const result = await reconcileControlGrants(db);

    expect(result.skipped).toBe(true);
    expect(grants(executed)).toEqual([]);
  });

  // TEST_SCENARIO: The controller reads a definition only to render it. Display fields, kit bookkeeping, image-update bookkeeping and knowledge-base fields are the api-server's alone; granting the table wholesale would hand all of them over.
  it("grants a definition's rendered columns and nothing else", async () => {
    const { db, executed } = fakeDb(catalogReply({}));

    await reconcileControlGrants(db);

    const agentGrant = grants(executed).find(
      (text) => text.includes("SELECT") && text.includes('"control"."agents"'),
    );
    expect(agentGrant).toBeDefined();
    for (const rendered of [
      "image",
      "harness",
      "cpu_limit",
      "memory_limit",
      "hibernation_timeout_ns",
      "sweepable",
      "generation",
      "owner_sub",
      "incarnation",
    ]) {
      expect(agentGrant).toContain(`"${rendered}"`);
    }
    for (const withheld of [
      "whispers_off",
      "avatar",
      "description",
      "kb_template_id",
      "kb_share_roots",
      "image_update_from",
      "image_update_refused",
    ]) {
      expect(agentGrant).not.toContain(`"${withheld}"`);
    }
  });

  // TEST_SCENARIO: On the one shared row, the controller may only mark an activity window reclaimed. Everything else on it — the pins, the stop request, the disable, the activity itself — belongs to the api-server, and a test that only pins the two granted columns would let a third slip into the list.
  it("lets the controller write only the reclaim columns of the signals row", async () => {
    const { db, executed } = fakeDb(catalogReply({}));

    await reconcileControlGrants(db);

    const updates = grants(executed).filter(
      (text) =>
        text.includes("UPDATE") && text.includes('"control"."agent_signals"'),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain('"reclaimed_at"');
    expect(updates[0]).toContain('"reclaimed_activity_token"');
    for (const withheld of [
      "last_activity_at",
      "last_activity_token",
      "session_pinned",
      "invocation_pinned",
      "stop_request_token",
      "disabled_at",
      "roll_rev",
      "version",
    ]) {
      expect(updates[0]).not.toContain(`"${withheld}"`);
    }
  });

  // TEST_SCENARIO: Three surfaces must stay unreachable however the grants are edited: the kit bookkeeping the api-server owns, the snapshot archive that holds the pre-move credentials, and the connection itself, whose credentials and inputs the controller never sees. It reads the connection-grant projection instead.
  it("never grants the api-server's own tables or the connection", async () => {
    const { db, executed } = fakeDb(catalogReply({}));

    await reconcileControlGrants(db);

    for (const withheld of [
      "crd_snapshots",
      "agent_kit_state",
      '"connections"',
    ]) {
      expect(grants(executed).join("\n")).not.toContain(withheld);
    }
    expect(grants(executed).join("\n")).toContain("agent_connection_grants");
  });

  // TEST_SCENARIO: The grants are re-issued on every start so that a role created before or after this build's migrations converges either way. Re-issuing must still name the schema, since an unqualified name resolves through search_path onto whatever shadows it.
  it("schema-qualifies every grant and takes schema usage", async () => {
    const { db, executed } = fakeDb(catalogReply({}));

    await reconcileControlGrants(db);

    const emitted = grants(executed);
    expect(emitted.some((text) => text.includes('"control"."agents"'))).toBe(
      true,
    );
    expect(
      emitted.some(
        (text) =>
          text.includes("USAGE ON SCHEMA") && text.includes('"control"'),
      ),
    ).toBe(true);
  });

  // TEST_SCENARIO: What the role can actually reach is measured after the grants, and anything it still cannot is reported rather than assumed fixed — a column renamed in a migration would otherwise silently stop the controller.
  it("reports a privilege the role still lacks", async () => {
    const { db } = fakeDb(catalogReply({ missingColumns: ["image"] }));

    const result = await reconcileControlGrants(db);

    expect(result.missing).toContain("SELECT ON control.agents.image");
  });

  // TEST_SCENARIO: Work is bounded because it blocks startup. Both timeouts are set through set_config, which takes a bind parameter, because SET LOCAL cannot.
  it("bounds the transaction with a lock and statement timeout", async () => {
    const { db, executed } = fakeDb(catalogReply({}));

    await reconcileControlGrants(db);

    const text = executed.map((e) => e.text).join("\n");
    expect(text).toContain("set_config('lock_timeout'");
    expect(text).toContain("set_config('statement_timeout'");
    expect(text).not.toContain("SET LOCAL");
  });

  // TEST_SCENARIO: Every table the grant list names is one the schema defines, so a rename lands as a failing test rather than as a startup warning on the one install that has the role.
  it("names only tables the control schema defines", () => {
    expect(CONTROL_GRANTS.length).toBeGreaterThan(0);
    for (const grant of CONTROL_GRANTS) {
      expect(grant.object).toMatch(/^control\.[a-z0-9_]+$/);
    }
  });
});

describe("control grant reporting", () => {
  const base: ControlGrants = {
    role: "platform_controller",
    rolePresent: true,
    skipped: false,
    granted: ["SELECT ON control.agents"],
    missing: [],
  };

  type LogLine = [string, string, Record<string, unknown>];

  function report(patch: Partial<ControlGrants>): LogLine[] {
    const lines: LogLine[] = [];
    const record =
      (level: string) => (o: Record<string, unknown>, msg: string) =>
        lines.push([level, msg, o]);
    const logger = {
      info: record("info"),
      warn: record("warn"),
    } as unknown as Logger;
    reportControlGrants(logger, { ...base, ...patch });
    return lines;
  }

  // TEST_SCENARIO: The branches are ordered by what an operator can do about them: a failed reconcile, a role nobody created, a lost lock, a privilege this role still lacks, and the ordinary path that says what it granted.
  it("reports each state under its own name", () => {
    expect(
      report({ failed: "boom" }).map(([level, msg]) => [level, msg]),
    ).toEqual([["warn", "control.grants.failed"]]);
    expect(
      report({ rolePresent: false }).map(([level, msg]) => [level, msg]),
    ).toEqual([["info", "control.grants.role-absent"]]);
    expect(
      report({ skipped: true }).map(([level, msg]) => [level, msg]),
    ).toEqual([["info", "control.grants.skipped"]]);
    expect(report({ missing: ["SELECT ON control.agents"] })[0]?.[1]).toBe(
      "control.grants.incomplete",
    );
    expect(report({})[0]?.[1]).toBe("control.grants.reconciled");
  });
});
