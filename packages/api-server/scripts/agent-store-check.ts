/**
 * TEST_OVERVIEW: the Postgres Agent and budget adapters on a real database. The
 * unit suite pins the mapping and the feed; what only a real server can show is
 * that the lifecycle statements behave as the versioned transactions the design
 * asks for — a definition write that names its generation, a disable a wake
 * cannot slip past, a pin released only by the version that set it, an activity
 * restore that applies to exactly the write it undid, and a delete that takes
 * the children with it.
 *
 * Run by `mise run //packages/api-server:test:agent-store` against a disposable
 * database with this branch's migrations applied.
 */
import { createDb, sql } from "db";
import { createControlAgentsRepository } from "../src/modules/agent-store/agents-repository.js";
import { createControlAgentStateCache } from "../src/modules/agent-store/cache.js";
import { createAgentChangeFeed } from "../src/modules/agent-store/feed.js";
import {
  deleteUserBudget,
  listUserBudgets,
  readUserBudget,
  readUserBudgetSizes,
  writeUserBudget,
} from "../src/modules/agent-store/user-budgets.js";
import { parseInfraAgent } from "../src/modules/agents/infrastructure/agent-mappers.js";

const url = process.env.AGENT_STORE_DATABASE_URL;
if (!url) {
  process.stderr.write(
    "AGENT_STORE_DATABASE_URL must point at a disposable database with the migrations applied\n",
  );
  process.exit(2);
}

const { db, sql: client } = createDb(url, { poolMax: 4 });
const failures: string[] = [];
let checked = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checked += 1;
  if (ok) process.stdout.write(`  ok   ${name}\n`);
  else {
    failures.push(`${name}${detail ? `: ${detail}` : ""}`);
    process.stdout.write(`  FAIL ${name}${detail ? `: ${detail}` : ""}\n`);
  }
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const AGENT = "agent-store-check";
const OWNER = "sub-store-check";

const cache = createControlAgentStateCache({
  db,
  feed: createAgentChangeFeed({
    source: {
      listen: async () => ({ unlisten: async () => {} }),
    },
    snapshot: async () => {},
    log: () => {},
  }),
  log: () => {},
});
const repo = createControlAgentsRepository(db, cache);

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM control.agents WHERE id = ${AGENT}`);
  await db.execute(
    sql`DELETE FROM control.user_budgets WHERE owner_sub = ${OWNER}`,
  );
}

async function main(): Promise<void> {
  await cleanup();

  // TEST_SCENARIO: A create writes the definition, its signals and its hosts in one go.
  const created = await repo.create(
    {
      image: "agent:1",
      resources: { limits: { cpu: "2", memory: "4Gi" } },
      hibernationTimeout: "90m0s",
      l7Hosts: ["a.test", "b.test"],
    },
    OWNER,
    AGENT,
  );
  check("a create returns the Agent it wrote", created.id === AGENT);
  check("the created Agent reads back ready-shaped", created.spec.image === "agent:1");
  check(
    "its idle timeout survives as the same duration",
    created.spec.hibernationTimeout === "1h30m0s",
    created.spec.hibernationTimeout,
  );
  check(
    "its hosts survive as a set",
    JSON.stringify(created.spec.l7Hosts) === JSON.stringify(["a.test", "b.test"]),
    JSON.stringify(created.spec.l7Hosts),
  );

  // TEST_SCENARIO: A definition write names the generation it decided from.
  const live = await repo.getLive(AGENT, OWNER);
  const generation = live?.resourceVersion ?? "";
  const written = await repo.writeAgentSpec(AGENT, OWNER, {
    spec: { image: "agent:2" },
    annotations: {},
    resourceVersion: generation,
  });
  check("a spec write at the live generation lands", written.ok);
  const stale = await repo.writeAgentSpec(AGENT, OWNER, {
    spec: { image: "agent:3" },
    annotations: {},
    resourceVersion: generation,
  });
  check(
    "the same generation cannot be written twice",
    !stale.ok && stale.reason === "conflict",
    JSON.stringify(stale),
  );
  const afterWrite = await repo.getLive(AGENT, OWNER);
  check("the second write did not land", afterWrite?.spec.image === "agent:2");

  // TEST_SCENARIO: A disabled Agent cannot be woken; enabling clears the mark without waking.
  await repo.setDisabled(AGENT, true);
  const wokeDisabled = await repo.wake(AGENT);
  check(
    "a wake on a disabled Agent is refused",
    !wokeDisabled.ok && wokeDisabled.error.type === "AgentDisabled",
    JSON.stringify(wokeDisabled),
  );
  await repo.setDisabled(AGENT, false);
  const wokeEnabled = await repo.wake(AGENT);
  check("a wake after enabling lands", wokeEnabled.ok);

  // TEST_SCENARIO: An invocation pin is released only by the version that set it.
  const pinned = await repo.setInvocationPin(AGENT);
  check("a pin is set", pinned);
  const version = await repo.readInvocationPin(AGENT);
  check("the pin reports its version", version !== null);
  await repo.releaseInvocationPin(AGENT, "999999");
  check(
    "a release at the wrong version does nothing",
    (await repo.readInvocationPin(AGENT)) === version,
  );
  await repo.releaseInvocationPin(AGENT, version ?? "");
  check("a release at its version clears it", (await repo.readInvocationPin(AGENT)) === null);

  // TEST_SCENARIO: An activity restore applies to exactly the write it undid.
  const stamp = await repo.wakeIfHibernated(AGENT);
  check("an activity write reports what it replaced", stamp !== null);
  await repo.wakeUnlessStopped(AGENT);
  await repo.restoreActivityIfUnchanged(AGENT, stamp!);
  const afterRacingWake = (await repo.getLive(AGENT, OWNER))!;
  check(
    "a restore after another activity write is a no-op",
    afterRacingWake.quietSince !== undefined &&
      afterRacingWake.quietSince.getTime() !==
        new Date(stamp!.previousAt ?? "1970-01-01T00:00:00Z").getTime(),
  );

  const second = await repo.wakeIfHibernated(AGENT);
  await repo.restoreActivityIfUnchanged(AGENT, second!);
  const restored = (await repo.getLive(AGENT, OWNER))!;
  check(
    "a restore with nothing in between puts the previous time back",
    restored.quietSince?.getTime() ===
      new Date(second!.previousAt ?? "1970-01-01T00:00:00Z").getTime(),
    `${restored.quietSince?.toISOString()} vs ${second!.previousAt}`,
  );

  // TEST_SCENARIO: A restart copies the revision verbatim.
  await repo.restart(AGENT, OWNER);
  const rolled = await cache.get(AGENT);
  check(
    "a restart writes a roll revision",
    (rolled?.metadata?.annotations?.["agent-platform.ai/roll-rev"] ?? "") !== "",
    JSON.stringify(rolled?.metadata?.annotations ?? {}),
  );

  // TEST_SCENARIO: The controller's reclaim column is not the api-server's to write.
  let refused = false;
  try {
    await repo.patchAnnotation(AGENT, "agent-platform.ai/reclaimed-at", new Date().toISOString());
  } catch {
    refused = true;
  }
  check("the api-server cannot write the reclaim mark", refused);

  // TEST_SCENARIO: Budgets: a value sets, null inherits, a field left out is kept.
  const writtenBudget = await writeUserBudget(db, {
    ownerSub: OWNER,
    change: { memory: "16Gi" },
    setBySub: "operator-1",
  });
  check("a budget write records its operator", writtenBudget.row?.setBySub === "operator-1");
  check(
    "a field left out stays unset",
    (await readUserBudgetSizes(db, OWNER)).cpu === null,
  );
  await writeUserBudget(db, { ownerSub: OWNER, change: { cpu: "4" }, setBySub: "operator-1" });
  const kept = await readUserBudgetSizes(db, OWNER);
  check("a later write keeps the earlier field", kept.memory === "16Gi" && kept.cpu === "4");
  await writeUserBudget(db, {
    ownerSub: OWNER,
    change: { cpu: null, memory: null },
    setBySub: "operator-1",
  });
  check("dropping the last field deletes the row", (await readUserBudget(db, OWNER)) === null);
  check("the list agrees", (await listUserBudgets(db)).every((row) => row.ownerSub !== OWNER));
  await writeUserBudget(db, { ownerSub: OWNER, change: { storage: "20Gi" }, setBySub: "operator-1" });
  check("a delete reports what it removed", (await deleteUserBudget(db, OWNER))?.storage === "20Gi");

  // TEST_SCENARIO: the cache lists what the store holds, and a delete takes the children with it.
  const listed = await cache.list(OWNER);
  check("the cache lists the Agent by owner", listed.some((obj) => obj.metadata?.name === AGENT));
  const deleted = await repo.delete(AGENT, OWNER);
  check("a delete reports success", deleted);
  const gone = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM control.agent_signals WHERE agent_id = ${AGENT}`,
  );
  check(
    "a delete takes the signals row with it",
    (gone as unknown as Array<{ count: string }>)[0]?.count === "0",
  );
  const remaining = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM control.agents WHERE id = ${AGENT}`,
  );
  check(
    "the definition is gone",
    (remaining as unknown as Array<{ count: string }>)[0]?.count === "0",
  );
  await cache.stop();
}

await main()
  .catch((cause) => {
    failures.push(`the run stopped: ${reasonOf(cause)}`);
  })
  .then(async () => {
    await cleanup().catch(() => {});
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
