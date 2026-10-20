/**
 * TEST_OVERVIEW: real-PostgreSQL check for the one-off permission-mode reset and the Config
 * panel's change, run by `mise run //packages/api-server:test:harness-config-concurrency`
 * against a disposable database with this branch's migrations applied.
 *
 * It drives the actual repositories and services over several connections and
 * asserts transaction outcomes — no deadlock, what committed, and what the
 * Agent's declaration says against the durable event order — rather than the
 * order of mocked calls, which cannot show a lock cycle.
 */
import { createDb, sql } from "db";
import {
  createAgentsRuntimeRepo,
  createOutboxRepo,
} from "../src/modules/runtime-delivery/infrastructure/outbox-repo.js";
import { createHarnessConfigEventQueue } from "../src/modules/harness-config/infrastructure/config-event-queue.js";
import { createHarnessConfigResetRepo } from "../src/modules/harness-config/infrastructure/reset-repo.js";
import { createHarnessConfigReset } from "../src/modules/harness-config/services/harness-config-reset.js";
import { createHarnessConfigSnapshotRepo } from "../src/modules/harness-config/infrastructure/snapshot-repo.js";
import { createHarnessConfigService } from "../src/modules/harness-config/services/harness-config-service.js";

const url = process.env.HARNESS_CONFIG_DATABASE_URL;
if (!url) {
  process.stderr.write(
    "HARNESS_CONFIG_DATABASE_URL must point at a disposable database with the migrations applied\n",
  );
  process.exit(2);
}

const TEMPLATE = "ibm-litellm";
const HARNESS = "claude-code";
const RESET_NAME = "ibm-litellm-bypass-mode-check";
const ETE = "ete-check";

const { db, sql: client } = createDb(url);
const outboxRepo = createOutboxRepo(db);
const agentsRuntimeRepo = createAgentsRuntimeRepo(db);
const snapshotRepo = createHarnessConfigSnapshotRepo(db);
const eventQueue = createHarnessConfigEventQueue({ db, outboxRepo });

const failures: string[] = [];
let checked = 0;
function check(name: string, ok: boolean, detail = "") {
  checked += 1;
  if (ok) process.stdout.write(`  ok   ${name}\n`);
  else {
    failures.push(`${name}${detail ? `: ${detail}` : ""}`);
    process.stdout.write(`  FAIL ${name}${detail ? `: ${detail}` : ""}\n`);
  }
}

let seq = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++seq}`;
const RUN = unique("run");

/** UNIT_BOUNDARY_DESCRIPTION: fills every NOT NULL column the caller did not set, so fixtures survive schema changes. */
async function insertRow(
  table: string,
  values: Record<string, unknown>,
): Promise<void> {
  const columns = (await db.execute(sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position
  `)) as unknown as {
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }[];
  const row: Record<string, unknown> = { ...values };
  for (const column of columns) {
    if (row[column.column_name] !== undefined) continue;
    if (column.is_nullable === "YES" || column.column_default !== null)
      continue;
    if (column.data_type === "jsonb") row[column.column_name] = {};
    else if (column.data_type.startsWith("timestamp"))
      row[column.column_name] = new Date();
    else if (column.data_type === "boolean") row[column.column_name] = false;
    else if (column.data_type === "ARRAY") row[column.column_name] = [];
    else if (/int|numeric|double|real/.test(column.data_type))
      row[column.column_name] = 0;
    else row[column.column_name] = "x";
  }
  const keys = Object.keys(row);
  await db.execute(sql`
    INSERT INTO ${sql.raw(`"${table}"`)}
      (${sql.raw(keys.map((k) => `"${k}"`).join(", "))})
    VALUES (${sql.join(
      keys.map((k) => {
        const value = row[k];
        return value && typeof value === "object" && !(value instanceof Date)
          ? sql`${JSON.stringify(value)}::jsonb`
          : sql`${value}`;
      }),
      sql`, `,
    )})
  `);
}

async function agent(mode: string | null, opts: { named?: boolean } = {}) {
  const id = unique("agent");
  const at = new Date().toISOString();
  const own = (value: string) => ({
    mode: value,
    model: null,
    configOptions: {},
    availableModels: null,
    capturedAt: at,
    confirmed: false,
  });
  /* UNIT_BOUNDARY_DESCRIPTION: a stored snapshot must parse, so the named shape
   * keeps the root's required fields too; the harness's own entry overrides the
   * root mode. */
  const snapshot =
    mode === null
      ? {}
      : opts.named === true
        ? {
            ...own(mode),
            mode: null,
            harnesses: { [HARNESS]: own(mode) },
          }
        : own(mode);
  await insertRow("agents", { id, harness_config_snapshot: snapshot });
  await insertRow("connection_grants", { agent_id: id, connection_id: ETE });
  return id;
}

async function declaration(agentId: string): Promise<string | null> {
  const rows = (await db.execute(sql`
    SELECT coalesce(
      harness_config_snapshot -> 'harnesses' -> ${HARNESS} ->> 'mode',
      harness_config_snapshot ->> 'mode'
    ) AS mode
    FROM agents WHERE id = ${agentId}
  `)) as unknown as { mode: string | null }[];
  return rows[0]?.mode ?? null;
}

async function events(
  agentId: string,
): Promise<{ at: number; mode: unknown }[]> {
  const rows = (await db.execute(sql`
    SELECT substring(id from '([0-9]+)$')::bigint AS at, payload -> 'mode' AS mode
    FROM runtime_events
    WHERE agent_id = ${agentId} AND kind = 'harness-config'
    ORDER BY id
  `)) as unknown as { at: string; mode: unknown }[];
  return rows.map((row) => ({ at: Number(row.at), mode: row.mode }));
}

function resetRepo(name: string) {
  return createHarnessConfigResetRepo({
    db,
    reset: `${RESET_NAME}-${RUN}-${name}`,
    template: TEMPLATE,
    harness: HARNESS,
    from: "bypassPermissions",
  });
}

function reset(
  name: string,
  opts: {
    repo?: ReturnType<typeof resetRepo>;
    snapshotRepo?: typeof snapshotRepo;
  } = {},
) {
  return createHarnessConfigReset({
    repo: opts.repo ?? resetRepo(name),
    snapshotRepo: opts.snapshotRepo ?? snapshotRepo,
    eventQueue,
    enqueue: async () => {},
    ownerOf: async () => null,
    harness: HARNESS,
    from: "bypassPermissions",
    to: "auto",
    log: () => {},
  });
}

/* UNIT_BOUNDARY_DESCRIPTION: the app's own wiring — a Config save retires a pending correction. */
const serviceRetiring = (name: string) => {
  const repo = resetRepo(name);
  return createHarnessConfigService({
    surface: "check",
    eventQueue,
    runtimeMutator: { enqueueAfterCommit: async () => {} } as never,
    snapshotRepo,
    pairRepo: {} as never,
    catalog: { harnesses: [] } as never,
    ownerSub: "owner-check",
    isOwnedAgent: async () => true,
    getCapabilities: async () => ({
      harnessConfig: true,
      harnesses: [
        { name: HARNESS, harnessConfig: true, sessionModel: false },
        { name: "codex", harnessConfig: true, sessionModel: false },
      ],
    }),
    specHarness: async () => undefined,
    isSettled: async () => true,
    retireReset: (agentId, tx, harness) => repo.retire(agentId, tx, harness),
  });
};

const service = createHarnessConfigService({
  surface: "check",
  eventQueue,
  runtimeMutator: { enqueueAfterCommit: async () => {} } as never,
  snapshotRepo,
  pairRepo: {} as never,
  catalog: { harnesses: [] } as never,
  ownerSub: "owner-check",
  isOwnedAgent: async () => true,
  getCapabilities: async () => ({
    harnessConfig: true,
    harnesses: [{ name: HARNESS, harnessConfig: true, sessionModel: false }],
  }),
  specHarness: async () => undefined,
  isSettled: async () => true,
});

/** UNIT_BOUNDARY_DESCRIPTION: holds one Agent's outbox row from another connection, to make the pass time out on that Agent alone. */
async function holdingOutbox(agentId: string) {
  let release!: () => void;
  const released = new Promise<void>((done) => {
    release = done;
  });
  let started!: () => void;
  const holding = new Promise<void>((done) => {
    started = done;
  });
  const done = db.transaction(async (tx) => {
    await outboxRepo.bumpVersion(agentId, tx);
    started();
    await released;
  });
  await holding;
  return async () => {
    release();
    await done;
  };
}

async function main() {
  const existing = (await db.execute(sql`
    SELECT 1 FROM connections WHERE id = ${ETE}
  `)) as unknown as unknown[];
  if (existing.length === 0)
    await insertRow("connections", { id: ETE, template_id: TEMPLATE });

  process.stdout.write("hello against the reset and the Config save\n");
  for (const [name, writer] of [
    [
      "reset",
      async (agentId: string) => {
        const outcome = await reset("hello")
          .run()
          .catch(() => null);
        return (
          (outcome?.reset ?? 0) >= 1 && (await declaration(agentId)) === "auto"
        );
      },
    ],
    [
      "config save",
      async (agentId: string) => {
        await service.apply(agentId, { mode: "plan" });
        return (await declaration(agentId)) === "plan";
      },
    ],
  ] as const) {
    const agentId = await agent("bypassPermissions");
    let helloDone!: () => void;
    const helloHeld = new Promise<void>((done) => {
      helloDone = done;
    });
    let writerDone!: () => void;
    const writerStart = new Promise<void>((done) => {
      writerDone = done;
    });
    /* TEST_SCENARIO: hello's transaction as hello-handler runs it: the Agent's row, then the outbox row. */
    const hello = db.transaction(async (tx) => {
      await agentsRuntimeRepo.upsertHello(
        {
          agentId,
          protocolVersion: "1",
          capabilities: { harnessConfig: true },
          agentRuntimeVersion: "check",
        },
        tx,
      );
      helloDone();
      await writerStart;
      await outboxRepo.bumpVersion(agentId, tx);
    });
    await helloHeld;
    const outcome = writer(agentId);
    await new Promise((done) => setTimeout(done, 150));
    writerDone();
    const [helloResult, writerResult] = await Promise.allSettled([
      hello,
      outcome,
    ]);
    check(
      `${name}: hello commits`,
      helloResult.status === "fulfilled",
      helloResult.status === "rejected" ? String(helloResult.reason) : "",
    );
    check(
      `${name}: the writer commits`,
      writerResult.status === "fulfilled" && writerResult.value === true,
      writerResult.status === "rejected" ? String(writerResult.reason) : "",
    );
  }

  process.stdout.write("an owner's choice against the reset\n");
  {
    const agentId = await agent("bypassPermissions");
    await reset("owner-after").run();
    await service.apply(agentId, { mode: "plan" });
    const seen = await events(agentId);
    check(
      "reset then owner: the declaration is the last event",
      (await declaration(agentId)) === "plan" && seen.at(-1)?.mode === "plan",
      JSON.stringify({ declaration: await declaration(agentId), seen }),
    );
  }
  {
    const agentId = await agent("bypassPermissions");
    await service.apply(agentId, { mode: "plan" });
    const outcome = await reset("owner-before").run();
    check(
      "owner then reset: the owner's mode survives",
      outcome.reset === 0 && (await declaration(agentId)) === "plan",
      JSON.stringify({ outcome, declaration: await declaration(agentId) }),
    );
  }

  process.stdout.write("both at once\n");
  {
    const agentId = await agent("bypassPermissions");
    const results = await Promise.allSettled([
      reset("both").run(),
      service.apply(agentId, { mode: "plan" }),
    ]);
    const seen = await events(agentId);
    const declared = await declaration(agentId);
    check(
      "neither fails and the declaration is the last event",
      results.every((r) => r.status === "fulfilled") &&
        declared === seen.at(-1)?.mode,
      JSON.stringify({ results, seen, declared }),
    );
    check(
      "the dedupe timestamps increase",
      seen.every(
        (event, index) => index === 0 || event.at > seen[index - 1]!.at,
      ),
      JSON.stringify(seen),
    );
  }

  process.stdout.write("a correction that never commits\n");
  {
    const agentId = await agent("bypassPermissions");
    const name = "rollback";
    const repo = resetRepo(name);
    /* TEST_SCENARIO: the cohort is frozen first, so the Agent has a pending row to settle. */
    await repo.roster();
    /* TEST_SCENARIO: the declaration fails after the claim and the queued event: everything
     * the pass did must roll back together, leaving the Agent pending. */
    const failing = {
      ...snapshotRepo,
      merge: async () => {
        throw new Error("declaration failed");
      },
    } as typeof snapshotRepo;
    const failed = await reset(name, { repo, snapshotRepo: failing }).run();
    const rows = (await db.execute(sql`
      SELECT settled_at IS NOT NULL AS settled FROM harness_config_resets
      WHERE reset = ${`${RESET_NAME}-${RUN}-${name}`} AND agent_id = ${agentId}
    `)) as unknown as { settled: boolean }[];
    check(
      "the failed correction leaves the Agent pending",
      failed.failed === 1 && rows.length === 1 && rows[0]?.settled === false,
      JSON.stringify({ failed, rows }),
    );
    check(
      "and commits no event or declaration",
      (await events(agentId)).length === 0 &&
        (await declaration(agentId)) === "bypassPermissions",
      JSON.stringify({
        events: await events(agentId),
        declaration: await declaration(agentId),
      }),
    );
    const retried = await reset(name, { repo }).run();
    check(
      "a later pass corrects it exactly once",
      retried.reset === 1 &&
        (await events(agentId)).length === 1 &&
        (await declaration(agentId)) === "auto",
      JSON.stringify({ retried, events: await events(agentId) }),
    );
  }

  process.stdout.write(
    "a stale pending list against another boot and the owner\n",
  );
  {
    const agentId = await agent("bypassPermissions");
    const name = "stale";
    const repo = resetRepo(name);
    await repo.roster();
    /* TEST_SCENARIO: this boot reads the pending list, then stalls before its
     * transaction. Narrowed to this Agent so the case is about its own
     * correction; the other members are covered by the cohort cases. */
    const pending = (await repo.pending({ after: "", limit: 100 })).filter(
      (id) => id === agentId,
    );
    await reset(name, { repo }).run();
    await service.apply(agentId, { mode: "bypassPermissions" });
    /* TEST_SCENARIO: resumed with the list it read before the other boot's correction. */
    let once = true;
    const stale = await reset(name, {
      repo: {
        ...repo,
        pending: async () => {
          if (!once) return [];
          once = false;
          return pending;
        },
      },
    }).run();
    const seen = await events(agentId);
    check(
      "the stale boot corrects nothing",
      stale.reset === 0 && stale.failed === 0,
      JSON.stringify({ stale }),
    );
    check(
      "the owner's later Bypass survives, with one reset event",
      (await declaration(agentId)) === "bypassPermissions" &&
        seen.map((event) => event.mode).join(",") === "auto,bypassPermissions",
      JSON.stringify({ declaration: await declaration(agentId), seen }),
    );
  }

  process.stdout.write("a delayed runtime report against the owner's choice\n");
  {
    const agentId = await agent("bypassPermissions", { named: true });
    const name = "report";
    const repo = resetRepo(name);
    const config = serviceRetiring(name);
    await repo.roster();
    /* TEST_SCENARIO: this boot reads the pending list, then stalls before its
     * transaction. Narrowed to this Agent so the case is about its own
     * correction; the other members are covered by the cohort cases. */
    const pending = (await repo.pending({ after: "", limit: 100 })).filter(
      (id) => id === agentId,
    );
    /* TEST_SCENARIO: the hello captured the old Bypass settings before the owner
     * acted, and its registration commits; its snapshot merge has not run yet. */
    await agentsRuntimeRepo.upsertHello({
      agentId,
      protocolVersion: "1",
      capabilities: { harnessConfig: true },
      agentRuntimeVersion: "check",
    });
    /* TEST_SCENARIO: the owner chooses Plan through the real Config service. */
    await config.apply(agentId, { harness: HARNESS, mode: "plan" });
    /* TEST_SCENARIO: the delayed report merges its stale Bypass over the owner's declaration. */
    await snapshotRepo.merge(
      agentId,
      { mode: "bypassPermissions" },
      { confirmed: true, harness: HARNESS },
    );
    check(
      "the delayed report really restores Bypass in the display snapshot",
      (await declaration(agentId)) === "bypassPermissions",
      JSON.stringify({ declaration: await declaration(agentId) }),
    );
    let once = true;
    const stale = await reset(name, {
      repo: {
        ...repo,
        pending: async () => {
          if (!once) return [];
          once = false;
          return pending;
        },
      },
    }).run();
    const seen = await events(agentId);
    const rows = (await db.execute(sql`
      SELECT settled_at IS NOT NULL AS settled FROM harness_config_resets
      WHERE reset = ${`${RESET_NAME}-${RUN}-${name}`} AND agent_id = ${agentId}
    `)) as unknown as { settled: boolean }[];
    check(
      "the frozen member was retired by the owner's choice, so the pass corrects nothing",
      stale.reset === 0 &&
        stale.failed === 0 &&
        pending.length === 1 &&
        rows[0]?.settled === true,
      JSON.stringify({ stale, rows, pending }),
    );
    check(
      "no Auto follows the owner's Plan",
      seen.map((event) => event.mode).join(",") === "plan",
      JSON.stringify({ seen }),
    );
  }

  process.stdout.write("a mode choice for another harness\n");
  {
    const agentId = await agent("bypassPermissions", { named: true });
    const name = "other-harness";
    const repo = resetRepo(name);
    const config = serviceRetiring(name);
    await repo.roster();
    /* TEST_SCENARIO: the owner picks a mode for a harness this correction does
     * not repair, and unsets it again; neither says anything about the Claude
     * Code mode the correction repairs, so the member must stay pending. */
    await config.apply(agentId, { harness: "codex", mode: "read-only" });
    await config.apply(agentId, { harness: "codex", unset: ["mode"] });
    const stillPending = (await db.execute(sql`
      SELECT settled_at IS NULL AS pending FROM harness_config_resets
      WHERE reset = ${`${RESET_NAME}-${RUN}-${name}`} AND agent_id = ${agentId}
    `)) as unknown as { pending: boolean }[];
    check(
      "another harness's mode choice leaves the correction pending",
      stillPending[0]?.pending === true,
      JSON.stringify({ stillPending }),
    );
    const outcome = await reset(name, { repo }).run();
    const after = (await db.execute(sql`
      SELECT settled_at IS NOT NULL AS settled FROM harness_config_resets
      WHERE reset = ${`${RESET_NAME}-${RUN}-${name}`} AND agent_id = ${agentId}
    `)) as unknown as { settled: boolean }[];
    check(
      "the correction still runs and sets Claude Code to auto",
      after[0]?.settled === true &&
        (await declaration(agentId)) === "auto" &&
        (await events(agentId)).some((event) => event.mode === "auto"),
      JSON.stringify({
        outcome,
        after,
        declaration: await declaration(agentId),
      }),
    );
    const modes = (await events(agentId)).map((event) => event.mode);
    check(
      "the Codex choices and the Claude Code correction both stand, in order",
      modes.join(",") === "read-only,,auto",
      JSON.stringify({ modes }),
    );
  }

  process.stdout.write("a failed Agent does not reopen the cohort\n");
  {
    const blocked = await agent("bypassPermissions");
    const initiallyAuto = await agent("auto");
    const release = await holdingOutbox(blocked);
    const first = await reset("cohort").run();
    await release();
    await service.apply(initiallyAuto, { mode: "bypassPermissions" });
    const late = await agent("bypassPermissions");
    const second = await reset("cohort").run();
    check(
      "the blocked Agent is retried and reset",
      first.failed === 1 && (await declaration(blocked)) === "auto",
      JSON.stringify({ first, declaration: await declaration(blocked) }),
    );
    check(
      "an Agent set to Bypass afterwards keeps it",
      (await declaration(initiallyAuto)) === "bypassPermissions" &&
        (await events(initiallyAuto)).at(-1)?.mode === "bypassPermissions",
      JSON.stringify({ declaration: await declaration(initiallyAuto) }),
    );
    check(
      "an Agent granted the Connection afterwards is never selected",
      (await declaration(late)) === "bypassPermissions" &&
        (await events(late)).length === 0,
      JSON.stringify({ declaration: await declaration(late), second }),
    );
    const third = await reset("cohort").run();
    check(
      "a pass over a settled cohort changes nothing",
      third.reset === 0 && third.failed === 0,
      JSON.stringify(third),
    );
  }
}

try {
  await main();
} finally {
  await client.end({ timeout: 0 });
}

process.stdout.write(
  failures.length === 0
    ? `\nall ${checked} checks passed\n`
    : `\n${failures.length} of ${checked} checks failed:\n${failures.map((f) => `  - ${f}`).join("\n")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
