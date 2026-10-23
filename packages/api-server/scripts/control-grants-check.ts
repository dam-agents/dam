/**
 * TEST_OVERVIEW: the controller's database privileges on a real PostgreSQL. The
 * unit suite pins the grant statements; only a real server refuses a statement,
 * so this drives them as the controller's own role and asserts both directions:
 * what it must reach to reconcile an Agent, and every surface it must not
 * reach — definitions, signals, budgets, the connection itself, the kit
 * bookkeeping and the snapshot archive.
 *
 * Every attempt runs in its own transaction, because the first refusal aborts a
 * transaction and would mask every check after it.
 *
 * Run by `mise run //packages/api-server:test:control-grants` against a
 * disposable database with this branch's migrations applied, on a server where
 * creating and dropping `platform_controller` is acceptable.
 */
import { createDb, sql, type DbTx } from "db";
import {
  CONTROL_ROLE,
  reconcileControlGrants,
} from "../src/modules/agent-store/infrastructure/control-grants.js";

const url = process.env.CONTROL_GRANTS_DATABASE_URL;
if (!url) {
  process.stderr.write(
    "CONTROL_GRANTS_DATABASE_URL must point at a disposable database with the migrations applied\n",
  );
  process.exit(2);
}

const { db, sql: client } = createDb(url, { poolMax: 1 });

const AGENT = "agent-grants-check";
const OWNER = "sub-grants-check";

const failures: string[] = [];
let checked = 0;

const reasonOf = (cause: unknown): string => {
  const inner = (cause as { cause?: unknown } | null)?.cause;
  if (inner instanceof Error) return inner.message;
  return cause instanceof Error ? cause.message : String(cause);
};

function check(name: string, ok: boolean, detail = ""): void {
  checked += 1;
  if (ok) process.stdout.write(`  ok   ${name}\n`);
  else {
    failures.push(`${name}${detail ? `: ${detail}` : ""}`);
    process.stdout.write(`  FAIL ${name}${detail ? `: ${detail}` : ""}\n`);
  }
}

async function dropRole(): Promise<void> {
  const present = await db.execute<{ present: boolean }>(
    sql`SELECT to_regrole(${CONTROL_ROLE}) IS NOT NULL AS present`,
  );
  if (!present[0]?.present) return;
  await db
    .execute(sql`DROP OWNED BY ${sql.identifier(CONTROL_ROLE)}`)
    .catch(() => {});
  await db
    .execute(sql`DROP ROLE IF EXISTS ${sql.identifier(CONTROL_ROLE)}`)
    .catch(() => {});
}

type Expectation = "reach" | "refuse";
type Attempt = {
  name: string;
  expect: Expectation;
  run: (tx: DbTx) => Promise<unknown>;
};

async function asController(run: (tx: DbTx) => Promise<unknown>) {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE ${sql.identifier(CONTROL_ROLE)}`);
      await run(tx);
    });
    return { ok: true as const };
  } catch (cause) {
    return { ok: false as const, reason: reasonOf(cause) };
  }
}

const ATTEMPTS: Attempt[] = [
  {
    name: "reads a definition's rendered columns",
    expect: "reach",
    run: (tx) =>
      tx.execute(
        sql`SELECT id, owner_sub, image, cpu_limit, hibernation_timeout_ns, sweepable, generation FROM control.agents WHERE id = ${AGENT}`,
      ),
  },
  {
    name: "reads the signals row",
    expect: "reach",
    run: (tx) =>
      tx.execute(
        sql`SELECT version, last_activity_at, session_pinned, roll_rev FROM control.agent_signals WHERE agent_id = ${AGENT}`,
      ),
  },
  {
    name: "marks an activity window reclaimed",
    expect: "reach",
    run: (tx) =>
      tx.execute(
        sql`UPDATE control.agent_signals SET reclaimed_at = now(), reclaimed_activity_token = gen_random_uuid() WHERE agent_id = ${AGENT}`,
      ),
  },
  {
    name: "locks the signals row it must not write",
    expect: "reach",
    run: (tx) =>
      tx.execute(
        sql`SELECT 1 FROM control.agent_signals WHERE agent_id = ${AGENT} FOR SHARE`,
      ),
  },
  {
    name: "writes a status observation",
    expect: "reach",
    run: (tx) =>
      tx.execute(
        sql`INSERT INTO control.agent_status (agent_id, observed_generation) VALUES (${AGENT}, 1)
            ON CONFLICT (agent_id) DO UPDATE SET observed_generation = 1`,
      ),
  },
  {
    name: "writes a condition",
    expect: "reach",
    run: (tx) =>
      tx.execute(
        sql`INSERT INTO control.agent_conditions (agent_id, type, status, reason, observed_generation, last_transition_at)
            VALUES (${AGENT}, 'Ready', 'True', 'Reconciled', 1, now())
            ON CONFLICT (agent_id, type) DO UPDATE SET status = 'True'`,
      ),
  },
  {
    name: "deletes a condition",
    expect: "reach",
    run: (tx) =>
      tx.execute(
        sql`DELETE FROM control.agent_conditions WHERE agent_id = ${AGENT}`,
      ),
  },
  {
    name: "reads the L7 hosts",
    expect: "reach",
    run: (tx) =>
      tx.execute(
        sql`SELECT host FROM control.agent_l7_hosts WHERE agent_id = ${AGENT}`,
      ),
  },
  {
    name: "reads the connection-grant projection",
    expect: "reach",
    run: (tx) =>
      tx.execute(
        sql`SELECT connection_id FROM control.agent_connection_grants WHERE agent_id = ${AGENT}`,
      ),
  },
  {
    name: "reads the owner's budget",
    expect: "reach",
    run: (tx) =>
      tx.execute(
        sql`SELECT owner_sub, cpu FROM control.user_budgets WHERE owner_sub = ${OWNER}`,
      ),
  },
  {
    name: "reads the store's own state",
    expect: "reach",
    run: (tx) => tx.execute(sql`SELECT absorbed_at FROM control.agent_store`),
  },
  {
    name: "updates a definition",
    expect: "refuse",
    run: (tx) =>
      tx.execute(
        sql`UPDATE control.agents SET image = 'other' WHERE id = ${AGENT}`,
      ),
  },
  {
    name: "inserts a definition",
    expect: "refuse",
    run: (tx) =>
      tx.execute(
        sql`INSERT INTO control.agents (id, owner_sub, image, cpu_limit, memory_limit)
            VALUES ('agent-grants-denied', ${OWNER}, 'img', '1', '1Gi')`,
      ),
  },
  {
    name: "deletes a definition",
    expect: "refuse",
    run: (tx) =>
      tx.execute(sql`DELETE FROM control.agents WHERE id = ${AGENT}`),
  },
  {
    name: "reads a definition's withheld column",
    expect: "refuse",
    run: (tx) =>
      tx.execute(sql`SELECT whispers_off FROM control.agents WHERE id = ${AGENT}`),
  },
  {
    name: "updates an activity signal",
    expect: "refuse",
    run: (tx) =>
      tx.execute(
        sql`UPDATE control.agent_signals SET last_activity_at = now() WHERE agent_id = ${AGENT}`,
      ),
  },
  {
    name: "clears a stop request",
    expect: "refuse",
    run: (tx) =>
      tx.execute(
        sql`UPDATE control.agent_signals SET stop_request_token = NULL WHERE agent_id = ${AGENT}`,
      ),
  },
  {
    name: "writes a budget",
    expect: "refuse",
    run: (tx) =>
      tx.execute(
        sql`INSERT INTO control.user_budgets (owner_sub, cpu) VALUES (${OWNER}, '1')`,
      ),
  },
  {
    name: "reads the kit bookkeeping",
    expect: "refuse",
    run: (tx) => tx.execute(sql`SELECT starter_kit FROM control.agent_kit_state`),
  },
  {
    name: "reads the snapshot archive",
    expect: "refuse",
    run: (tx) => tx.execute(sql`SELECT yaml FROM control.crd_snapshots`),
  },
  {
    name: "reads a connection",
    expect: "refuse",
    run: (tx) => tx.execute(sql`SELECT auth FROM public.connections`),
  },
  {
    name: "writes the store's own state",
    expect: "refuse",
    run: (tx) =>
      tx.execute(sql`UPDATE control.agent_store SET absorbed_at = now()`),
  },
  {
    name: "grants itself more",
    expect: "refuse",
    run: (tx) =>
      tx.execute(
        sql`GRANT SELECT ON control.agents TO ${sql.identifier(CONTROL_ROLE)}`,
      ),
  },
];

async function main(): Promise<void> {
  await dropRole();
  await db.execute(
    sql`CREATE ROLE ${sql.identifier(CONTROL_ROLE)} NOLOGIN NOSUPERUSER`,
  );

  const grants = await reconcileControlGrants(db);
  check(
    "the reconcile completes",
    grants.failed === undefined,
    grants.failed ?? "",
  );
  check("the reconcile finds the role", grants.rolePresent);
  check("the reconcile did not skip", !grants.skipped);
  check(
    "every granted privilege is in place",
    grants.missing.length === 0,
    grants.missing.join(", "),
  );

  await db.execute(sql`DELETE FROM control.agents WHERE id = ${AGENT}`);
  await db.execute(
    sql`DELETE FROM public.connections WHERE id = 'conn-grants-check'`,
  );
  await db.execute(sql`
    INSERT INTO control.agents (id, owner_sub, image, cpu_limit, memory_limit)
    VALUES (${AGENT}, ${OWNER}, 'img', '1', '1Gi')
  `);
  await db.execute(
    sql`INSERT INTO control.agent_signals (agent_id) VALUES (${AGENT})`,
  );
  await db.execute(sql`
    INSERT INTO public.connections (id, owner, template_id, name, inputs, contributions, auth)
    VALUES ('conn-grants-check', ${OWNER}, 'tpl', 'conn', '{}', '[]', '{"credential":"secret"}')
  `);
  await db.execute(sql`
    INSERT INTO public.connection_grants (connection_id, agent_id)
    VALUES ('conn-grants-check', ${AGENT})
  `);

  for (const attempt of ATTEMPTS) {
    const outcome = await asController(attempt.run);
    if (attempt.expect === "reach") {
      check(attempt.name, outcome.ok, outcome.ok ? "" : outcome.reason);
    } else {
      check(
        `cannot ${attempt.name}`,
        !outcome.ok,
        outcome.ok ? "the statement succeeded" : "",
      );
    }
  }

  await db.execute(sql`DELETE FROM control.agents WHERE id = ${AGENT}`);
  await db.execute(
    sql`DELETE FROM public.connections WHERE id = 'conn-grants-check'`,
  );
  await dropRole();
}

await main()
  .catch((cause) => {
    failures.push(`the run stopped: ${reasonOf(cause)}`);
  })
  .then(async () => {
    await dropRole();
    process.stdout.write(
      `\n${checked - failures.length}/${checked} checks passed\n`,
    );
    if (failures.length > 0) {
      process.stderr.write(
        `\nfailures:\n${failures.map((f) => `  - ${f}`).join("\n")}\n`,
      );
      process.exitCode = 1;
    }
  })
  .finally(() => client.end({ timeout: 5 }));
