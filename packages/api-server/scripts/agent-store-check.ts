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
import {
  createAgentChangeFeed,
  postgresChangeSource,
} from "../src/modules/agent-store/feed.js";
import {
  deleteUserBudget,
  listUserBudgets,
  readUserBudget,
  readUserBudgetSizes,
  writeUserBudget,
} from "../src/modules/agent-store/user-budgets.js";
import { parseInfraAgent } from "../src/modules/agents/infrastructure/agent-mappers.js";
import { absorbAgentStore } from "../src/modules/agent-store/absorb.js";
import { passCutoverBarrier } from "../src/modules/agent-store/barrier.js";
import { buildAgentStoreSnapshot } from "../src/modules/agent-store/snapshot.js";
import { createHash } from "node:crypto";
import type { KubeObject } from "../src/modules/agents/infrastructure/k8s.js";
import type { CoordinationV1Api } from "@kubernetes/client-node";
import { createControlAgentL7HostsPort } from "../src/modules/agent-store/l7-hosts-control.js";

const url = process.env.AGENT_STORE_DATABASE_URL;
if (!url) {
  process.stderr.write(
    "AGENT_STORE_DATABASE_URL must point at a disposable database with the migrations applied\n",
  );
  process.exit(2);
}

const { db, sql: client } = createDb(url, { poolMax: 4 });
const other = createDb(url, { poolMax: 1 });
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
const INTERLEAVE = "agent-store-interleave";
const INTERLEAVE_DELETE = "agent-store-interleave-delete";
const OWNER = "sub-store-check";
const INSTALL = {
  releaseName: "platform",
  namespace: "platform-agents",
  apiServer: "https://api.test:6443",
};

const feed = createAgentChangeFeed({
  source: postgresChangeSource(client),
  snapshot: () => cache.snapshot(),
  onChange: (id) => cache.invalidate(id),
  log: () => {},
  relistIntervalMs: 60_000,
});
const cache = createControlAgentStateCache({ db, feed, log: () => {} });
process.stderr.write("starting the change feed\n");
await feed.start();
process.stderr.write("feed listening\n");
const repo = createControlAgentsRepository(db, cache);

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM control.agents WHERE id = ${AGENT}`);
  await db.execute(
    sql`DELETE FROM control.agents WHERE id IN (${INTERLEAVE}, ${INTERLEAVE_DELETE})`,
  );
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
  check(
    "the created Agent reads back ready-shaped",
    created.spec.image === "agent:1",
  );
  check(
    "its idle timeout survives as the same duration",
    created.spec.hibernationTimeout === "1h30m0s",
    created.spec.hibernationTimeout,
  );
  check(
    "its hosts survive as a set",
    JSON.stringify(created.spec.l7Hosts) ===
      JSON.stringify(["a.test", "b.test"]),
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

  // TEST_SCENARIO: The image-update decisions depend on more than the rendered spec: a pin or an activity bump after the read must refuse the write, and so must a newer observation, because the decision was made on the idle, ready Agent it saw.
  const idleRead = (await repo.getLive(AGENT, OWNER))!;
  await repo.wake(AGENT);
  const refusedOnSignal = await repo.writeAgentSpec(AGENT, OWNER, {
    spec: { image: "agent:4" },
    annotations: {},
    resourceVersion: idleRead.resourceVersion,
    signalVersion: idleRead.signalVersion,
    statusVersion: idleRead.statusVersion,
  });
  check(
    "a write decided on an older signals version is refused",
    !refusedOnSignal.ok && refusedOnSignal.reason === "conflict",
    JSON.stringify(refusedOnSignal),
  );
  const stillOnTwo = await repo.getLive(AGENT, OWNER);
  check("the refused write did not land", stillOnTwo?.spec.image === "agent:2");

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
  check(
    "a release at its version clears it",
    (await repo.readInvocationPin(AGENT)) === null,
  );

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
    (rolled?.metadata?.annotations?.["agent-platform.ai/roll-rev"] ?? "") !==
      "",
    JSON.stringify(rolled?.metadata?.annotations ?? {}),
  );

  // TEST_SCENARIO: The controller's reclaim column is not the api-server's to write.
  let refused = false;
  try {
    await repo.patchAnnotation(
      AGENT,
      "agent-platform.ai/reclaimed-at",
      new Date().toISOString(),
    );
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
  check(
    "a budget write records its operator",
    writtenBudget.row?.setBySub === "operator-1",
  );
  check(
    "a field left out stays unset",
    (await readUserBudgetSizes(db, OWNER)).cpu === null,
  );
  await writeUserBudget(db, {
    ownerSub: OWNER,
    change: { cpu: "4" },
    setBySub: "operator-1",
  });
  const kept = await readUserBudgetSizes(db, OWNER);
  check(
    "a later write keeps the earlier field",
    kept.memory === "16Gi" && kept.cpu === "4",
  );
  await writeUserBudget(db, {
    ownerSub: OWNER,
    change: { cpu: null, memory: null },
    setBySub: "operator-1",
  });
  check(
    "dropping the last field deletes the row",
    (await readUserBudget(db, OWNER)) === null,
  );
  check(
    "the list agrees",
    (await listUserBudgets(db)).every((row) => row.ownerSub !== OWNER),
  );
  await writeUserBudget(db, {
    ownerSub: OWNER,
    change: { storage: "20Gi" },
    setBySub: "operator-1",
  });
  check(
    "a delete reports what it removed",
    (await deleteUserBudget(db, OWNER))?.storage === "20Gi",
  );

  // TEST_SCENARIO: the change feed is the platform's, not a stub's: a kit write and a disable both arrive through the real listener, and the cache serves the row after them rather than the one before.
  const listened = new Promise<void>((resolve) => {
    const subscription = feed.whenChanged(AGENT);
    void subscription.changed.then(() => {
      subscription.cancel();
      resolve();
    });
  });
  await repo.patchAnnotation(
    AGENT,
    "agent-platform.ai/starter-kit-onboarded",
    "2026-10-24T00:00:00Z",
  );
  const heard = await Promise.race([
    listened.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  check("a kit write publishes on the change feed", heard);
  const kitSeen = await cache.get(AGENT);
  check(
    "the cache serves the kit write it was notified of",
    kitSeen?.metadata?.annotations?.[
      "agent-platform.ai/starter-kit-onboarded"
    ] !== undefined,
    JSON.stringify(kitSeen?.metadata?.annotations ?? {}),
  );

  await repo.setDisabled(AGENT, true);
  const hidden = await cache.get(AGENT);
  check(
    "the cache serves the disable it was notified of",
    hidden?.metadata?.annotations?.["agent-platform.ai/disabled"] !== undefined,
    JSON.stringify(hidden?.metadata?.annotations ?? {}),
  );
  await repo.setDisabled(AGENT, false);

  // TEST_SCENARIO: two writers interleaved, not sequential — the competing write holds its lock uncommitted while the repository call starts, then commits. PostgreSQL re-checks the predicate after the wait, so the loser must see the winner's row, which a read-then-write could not.
  await db.execute(
    sql`UPDATE control.agent_signals SET stop_requested_at = NULL, disabled_at = NULL WHERE agent_id = ${AGENT}`,
  );
  await other.sql`BEGIN`;
  await other.sql`UPDATE control.agent_signals SET disabled_at = now() WHERE agent_id = ${AGENT}`;
  const racing = repo.wake(AGENT);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await other.sql`COMMIT`;
  const raced = await racing;
  check(
    "a wake that raced a committed disable is refused",
    !raced.ok && raced.error.type === "AgentDisabled",
    JSON.stringify(raced),
  );
  await db.execute(
    sql`UPDATE control.agent_signals SET disabled_at = NULL, stop_requested_at = NULL WHERE agent_id = ${AGENT}`,
  );

  // TEST_SCENARIO: an observation the controller writes advances the version a decision compares, so a rollback decided before a condition changed is refused instead of landing on state it never saw.
  await db.execute(sql`
    INSERT INTO control.agent_status (agent_id, observed_generation) VALUES (${AGENT}, 1)
    ON CONFLICT (agent_id) DO NOTHING
  `);
  const beforeCondition = (await repo.getLive(AGENT, OWNER))!;
  await db.execute(sql`
    INSERT INTO control.agent_conditions (agent_id, type, status, reason, observed_generation, last_transition_at)
    VALUES (${AGENT}, 'StartFailed', 'True', 'CrashLoop', 1, now())
    ON CONFLICT (agent_id, type) DO UPDATE SET status = 'True', last_transition_at = now()
  `);
  const conditioned = await repo.writeAgentSpec(AGENT, OWNER, {
    spec: { image: "agent:2" },
    annotations: {},
    resourceVersion: beforeCondition.resourceVersion,
    signalVersion: beforeCondition.signalVersion,
    statusVersion: beforeCondition.statusVersion,
  });
  check(
    "a write decided before a condition changed is refused",
    !conditioned.ok && conditioned.reason === "conflict",
    JSON.stringify(conditioned),
  );

  // TEST_SCENARIO: the reclaim columns are the controller's alone, and no api-server writer is allowed to touch them however it is written. The check pre-sets a mark the way the controller would, runs every writer, and asserts the columns are byte-identical afterwards — independent of how the code spells it.
  await db.execute(sql`
    UPDATE control.agent_signals
       SET reclaimed_at = now(), reclaimed_activity_token = gen_random_uuid()
     WHERE agent_id = ${AGENT}
  `);
  const reclaimOf = async () => {
    const rows = await db.execute<{ at: string | null; token: string | null }>(
      sql`SELECT reclaimed_at::text AS at, reclaimed_activity_token::text AS token
            FROM control.agent_signals WHERE agent_id = ${AGENT}`,
    );
    const row = (
      rows as unknown as Array<{ at: string | null; token: string | null }>
    )[0];
    return `${row?.at ?? ""}|${row?.token ?? ""}`;
  };
  const reclaimBefore = await reclaimOf();
  const reclaimStamp = await repo.wakeIfHibernated(AGENT);
  await repo.wake(AGENT);
  await repo.wakeUnlessStopped(AGENT);
  await repo.requestStop(AGENT);
  await repo.setDisabled(AGENT, true);
  await repo.setDisabled(AGENT, false);
  await repo.setInvocationPin(AGENT);
  const pin = await repo.readInvocationPin(AGENT);
  await repo.releaseInvocationPin(AGENT, pin ?? "");
  await repo.restart(AGENT, OWNER);
  await repo.patchAnnotation(
    AGENT,
    "agent-platform.ai/kit-update-skipped",
    "0123456789abcdef0123456789abcdef01234567",
  );
  await repo.patchSpec(AGENT, { name: "renamed" });
  if (reclaimStamp !== null)
    await repo.restoreActivityIfUnchanged(AGENT, reclaimStamp);
  check(
    "no api-server writer touches the reclaim columns",
    (await reclaimOf()) === reclaimBefore,
    `${reclaimBefore} -> ${await reclaimOf()}`,
  );
  await db.execute(
    sql`UPDATE control.agent_signals SET reclaimed_at = NULL, reclaimed_activity_token = NULL WHERE agent_id = ${AGENT}`,
  );

  // TEST_SCENARIO: the controller's status transaction and a definition write interleaved. The controller holds the signals row shared and is about to insert an observation whose foreign key needs a key-share lock on the definition. A definition row taken FOR UPDATE blocks that lock while the api-server waits for the signals row — a deadlock the api-server side loses. FOR NO KEY UPDATE is compatible with the key-share lock, so both transactions commit.
  const withDeadline = async <T>(
    name: string,
    work: Promise<T>,
  ): Promise<T> => {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${name} did not finish in 15 s`)),
        15_000,
      ),
    );
    return Promise.race([work, timeout]);
  };
  await repo.create(
    { image: "agent:1", resources: { limits: { cpu: "1", memory: "2Gi" } } },
    OWNER,
    INTERLEAVE,
  );
  const interleaveLive = (await repo.getLive(INTERLEAVE, OWNER))!;
  let interleaveWrite: Promise<unknown> | undefined;
  const controllerStatus = other.sql.begin(async (tx) => {
    await tx`SELECT version FROM control.agent_signals WHERE agent_id = ${INTERLEAVE} FOR SHARE`;
    interleaveWrite = repo.writeAgentSpec(INTERLEAVE, OWNER, {
      spec: { name: "interleaved" },
      annotations: {},
      resourceVersion: interleaveLive.resourceVersion,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await tx`INSERT INTO control.agent_conditions
               (agent_id, type, status, reason, observed_generation, last_transition_at)
             VALUES (${INTERLEAVE}, 'Interleave', 'False', 'Held', 1, now())`;
  });
  let interleaveOk = true;
  try {
    await withDeadline("the status transaction", controllerStatus);
    await withDeadline("the definition write", interleaveWrite!);
  } catch (cause) {
    interleaveOk = false;
    process.stdout.write(`  FAIL ${reasonOf(cause)}\n`);
  }
  check(
    "a status transaction and a definition write do not deadlock",
    interleaveOk,
  );

  // TEST_SCENARIO: the same interleaving with a delete. The controller holds the status row and is about to change a condition the cascade would remove; a delete that starts cascading before taking the signals lock waits on the condition while the trigger waits on the status row. Taking the signals lock first makes the delete wait for the whole status transaction instead.
  await repo.create(
    { image: "agent:1", resources: { limits: { cpu: "1", memory: "2Gi" } } },
    OWNER,
    INTERLEAVE_DELETE,
  );
  await db.execute(sql`
    INSERT INTO control.agent_status (agent_id, observed_generation)
    VALUES (${INTERLEAVE_DELETE}, 1) ON CONFLICT (agent_id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO control.agent_conditions
      (agent_id, type, status, reason, observed_generation, last_transition_at)
    VALUES (${INTERLEAVE_DELETE}, 'Ready', 'True', 'AllPodsReady', 1, now())
    ON CONFLICT (agent_id, type) DO NOTHING
  `);
  let deleteWrite: Promise<unknown> | undefined;
  const controllerDelete = other.sql.begin(async (tx) => {
    await tx`SELECT version FROM control.agent_signals WHERE agent_id = ${INTERLEAVE_DELETE} FOR SHARE`;
    await tx`SELECT 1 FROM control.agent_status WHERE agent_id = ${INTERLEAVE_DELETE} FOR UPDATE`;
    deleteWrite = repo.delete(INTERLEAVE_DELETE, OWNER);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await tx`UPDATE control.agent_conditions SET message = 'held'
               WHERE agent_id = ${INTERLEAVE_DELETE} AND type = 'Ready'`;
  });
  let deleteOk = true;
  try {
    await withDeadline("the delete", controllerDelete);
    const deletedNow = await withDeadline("the delete", deleteWrite!);
    deleteOk = deletedNow === true;
  } catch (cause) {
    deleteOk = false;
    process.stdout.write(`  FAIL ${reasonOf(cause)}\n`);
  }
  check("a delete and a status transaction do not deadlock", deleteOk);

  // TEST_SCENARIO: the cache lists what the store holds, and a delete takes the children with it.
  const listed = await cache.list(OWNER);
  check(
    "the cache lists the Agent by owner",
    listed.some((obj) => obj.metadata?.name === AGENT),
  );
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
  // TEST_SCENARIO: the L7 host projection over the rows writes the sets an agent has now and advances the definition's generation, which is what reached the machine as a spec change before the switch.
  const l7 = createControlAgentL7HostsPort(db);
  const l7Agent = await repo.create({ image: "agent:1" }, OWNER, "l7-check");
  const hostsOf = async (): Promise<string> => {
    const rows = (await db.execute(
      sql`SELECT host FROM control.agent_l7_hosts WHERE agent_id = ${l7Agent.id} ORDER BY host`,
    )) as unknown as Array<{ host: string }>;
    return rows.map((row) => row.host).join(",");
  };
  const generationOf = async (): Promise<number> => {
    const rows = (await db.execute(
      sql`SELECT generation FROM control.agents WHERE id = ${l7Agent.id}`,
    )) as unknown as Array<{ generation: string }>;
    return Number(rows[0]?.generation ?? "0");
  };
  const generationBefore = await generationOf();
  await l7.set(l7Agent.id, ["a.example.test", "b.example.test"]);
  check(
    "the L7 port writes the rows",
    (await hostsOf()) === "a.example.test,b.example.test",
  );
  await l7.set(l7Agent.id, ["b.example.test"]);
  check("the L7 port removes a host", (await hostsOf()) === "b.example.test");
  check(
    "an L7 change advances the generation",
    (await generationOf()) > generationBefore,
  );
  await l7.set(l7Agent.id, []);
  check("an empty set removes the rows", (await hostsOf()) === "");
  await repo.delete(l7Agent.id);

  await cache.stop();

  await absorbChecks();
}

const ABSORB_AGENT = "agent-store-absorb";
const ABSORB_BUDGET = "budget-sub-absorb";

const kubeAgent = (granted: string[]): KubeObject => ({
  apiVersion: "agent-platform.ai/v1",
  kind: "Agent",
  metadata: {
    name: ABSORB_AGENT,
    uid: "123e4567-e89b-42d3-a456-426614174000",
    generation: 9,
    creationTimestamp: "2026-10-01T08:00:00Z",
    labels: { "agent-platform.ai/owner": OWNER },
    annotations: { "agent-platform.ai/roll-rev": "rev-absorb" },
  } as KubeObject["metadata"],
  spec: {
    image: "agent:absorb",
    resources: { limits: { cpu: "2", memory: "4Gi" } },
    hibernationTimeout: "30m0s",
    l7Hosts: ["absorb.example.test"],
    grantedConnectionIds: granted,
  },
  status: { conditions: [] },
});

const kubeBudget = (): KubeObject => ({
  apiVersion: "agent-platform.ai/v1",
  kind: "UserBudget",
  metadata: {
    name: ABSORB_BUDGET,
    uid: null,
  } as unknown as KubeObject["metadata"],
  spec: { owner: "sub-absorb", cpu: "2" },
});

async function absorbChecks(): Promise<void> {
  await db.execute(sql`DELETE FROM control.agents`);
  await db.execute(sql`DELETE FROM control.user_budgets`);
  await db.execute(sql`DELETE FROM control.crd_snapshots`);
  await db.execute(sql`DELETE FROM control.agent_store`);

  const grantRows = await db.execute(
    sql`SELECT count(*)::int AS n FROM public.connection_grants WHERE agent_id = ${ABSORB_AGENT}`,
  );
  const granted =
    Number((grantRows as unknown as Array<{ n: number }>)[0]?.n ?? 0) === 0;

  const snapshotCount = async (): Promise<number> => {
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM control.crd_snapshots`,
    );
    return Number((rows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  };
  const stamp = async (): Promise<Date | null> => {
    const rows = await db.execute(
      sql`SELECT absorbed_at FROM control.agent_store WHERE id = 1`,
    );
    const value = (rows as unknown as Array<{ absorbed_at: Date | null }>)[0];
    return value?.absorbed_at ?? null;
  };
  const agentCount = async (): Promise<number> => {
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM control.agents WHERE id = ${ABSORB_AGENT}`,
    );
    return Number((rows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  };
  const markerData: Array<Record<string, string>> = [];
  const noBackup = { put: async () => {}, get: async () => null };

  // TEST_SCENARIO: a grant the database does not hold stops the absorb before anything is written, and names the Agent.
  const refusedAgent = kubeAgent(granted ? ["only-on-resource"] : []);
  let refused = "";
  try {
    await absorbAgentStore({
      db,
      logger: { info: () => {}, warn: () => {}, error: () => {} } as never,
      listCustomObjects: async (plural) =>
        plural === "agents" ? [refusedAgent] : ([kubeBudget()] as KubeObject[]),
      writeMarker: async (data) => void markerData.push(data),
      readMarker: async () => markerData.at(-1) ?? null,
      install: INSTALL,
      store: null,
      backupKeyPrefix: "crd-snapshots/test",
      backupRefPrefix: "s3://bucket",
      defaults: { cpuLimit: "1", memoryLimit: "2Gi" },
      absorbedByVersion: "test",
      now: new Date(),
    });
  } catch (cause) {
    refused = reasonOf(cause);
  }
  check(
    "the absorb refuses a connection-grant mismatch",
    refused.includes("connection grants"),
    refused,
  );
  check("a refused absorb wrote no stamp", (await stamp()) === null);
  check("a refused absorb imported no row", (await agentCount()) === 0);

  // TEST_SCENARIO: an object store that cannot read the copy back is no backup, so the absorb aborts before a row exists.
  let backupRefusal = "";
  try {
    await absorbAgentStore({
      db,
      logger: { info: () => {}, warn: () => {}, error: () => {} } as never,
      listCustomObjects: async (plural) =>
        plural === "agents" ? [kubeAgent([])] : [kubeBudget()],
      writeMarker: async (data) => void markerData.push(data),
      readMarker: async () => markerData.at(-1) ?? null,
      install: INSTALL,
      store: noBackup,
      backupKeyPrefix: "crd-snapshots/test",
      backupRefPrefix: "s3://bucket",
      defaults: { cpuLimit: "1", memoryLimit: "2Gi" },
      absorbedByVersion: "test",
      now: new Date(),
    });
  } catch (cause) {
    backupRefusal = reasonOf(cause);
  }
  check(
    "an unverifiable backup fails the absorb closed",
    backupRefusal.includes("cannot be read back"),
    backupRefusal,
  );
  check("a failed backup wrote no stamp", (await stamp()) === null);

  // TEST_SCENARIO: the absorb commits the rows, the archive and the stamp together; a rerun finds the stamp and writes nothing twice.
  const stored = new Map<string, Buffer>();
  const backupStore = {
    put: async (key: string, body: Buffer) => void stored.set(key, body),
    get: async (key: string) => stored.get(key) ?? null,
  };
  const first = await absorbAgentStore({
    db,
    logger: { info: () => {}, warn: () => {}, error: () => {} } as never,
    listCustomObjects: async (plural) =>
      plural === "agents" ? [kubeAgent([])] : [kubeBudget()],
    writeMarker: async (data) => void markerData.push(data),
    readMarker: async () => markerData.at(-1) ?? null,
    install: INSTALL,
    store: backupStore,
    backupKeyPrefix: "crd-snapshots/test",
    backupRefPrefix: "s3://bucket",
    defaults: { cpuLimit: "1", memoryLimit: "2Gi" },
    absorbedByVersion: "test",
    now: new Date("2026-10-24T12:00:00.000Z"),
  });
  check("the absorb committed", first.status === "absorbed");
  check("the Agent became a row", (await agentCount()) === 1);
  check("the archive became snapshot rows", (await snapshotCount()) === 2);
  check("the store carries the stamp", (await stamp()) !== null);
  check(
    "the marker names the store and the stamp",
    markerData.at(-1)?.store === "postgres" &&
      markerData.at(-1)?.["absorbed-at"] === "2026-10-24T12:00:00.000Z",
    JSON.stringify(markerData.at(-1)),
  );
  const archive = stored.get(
    `crd-snapshots/test/${createHash("sha256")
      .update(
        buildAgentStoreSnapshot({
          agents: [kubeAgent([])],
          budgets: [kubeBudget()],
        }).yaml,
      )
      .digest("hex")}.yaml`,
  );
  check("the verified copy is in the object store", archive !== undefined);

  const second = await absorbAgentStore({
    db,
    logger: { info: () => {}, warn: () => {}, error: () => {} } as never,
    listCustomObjects: async () => {
      throw new Error("a rerun must not read the custom resources again");
    },
    writeMarker: async (data) => void markerData.push(data),
    readMarker: async () => markerData.at(-1) ?? null,
    install: INSTALL,
    store: backupStore,
    backupKeyPrefix: "crd-snapshots/test",
    backupRefPrefix: "s3://bucket",
    defaults: { cpuLimit: "1", memoryLimit: "2Gi" },
    absorbedByVersion: "test",
    now: new Date(),
  });
  check(
    "a rerun skips the import and rewrites the marker",
    second.status === "skipped" && (await snapshotCount()) === 2,
  );

  // TEST_SCENARIO: a kill after the commit but before the marker write leaves the stamp; the next start skips the import and writes the marker, so neither state is lost nor written twice.
  await db.execute(sql`DELETE FROM control.agents`);
  await db.execute(sql`DELETE FROM control.user_budgets`);
  await db.execute(sql`DELETE FROM control.crd_snapshots`);
  await db.execute(sql`DELETE FROM control.agent_store`);
  markerData.length = 0;
  let markerAttempts = 0;
  let killed = "";
  try {
    await absorbAgentStore({
      db,
      logger: { info: () => {}, warn: () => {}, error: () => {} } as never,
      listCustomObjects: async (plural) =>
        plural === "agents" ? [kubeAgent([])] : [kubeBudget()],
      writeMarker: async () => {
        markerAttempts += 1;
        throw new Error("killed writing the marker");
      },
      readMarker: async () => null,
      install: INSTALL,
      store: backupStore,
      backupKeyPrefix: "crd-snapshots/test",
      backupRefPrefix: "s3://bucket",
      defaults: { cpuLimit: "1", memoryLimit: "2Gi" },
      absorbedByVersion: "test",
      now: new Date(),
    });
  } catch (cause) {
    killed = reasonOf(cause);
  }
  check(
    "a kill after the commit leaves the stamp and no marker",
    killed.includes("killed writing the marker") &&
      (await stamp()) !== null &&
      markerAttempts === 1,
  );
  const recovered = await absorbAgentStore({
    db,
    logger: { info: () => {}, warn: () => {}, error: () => {} } as never,
    listCustomObjects: async () => {
      throw new Error("a recovery must not import again");
    },
    writeMarker: async (data) => void markerData.push(data),
    readMarker: async () => markerData.at(-1) ?? null,
    install: INSTALL,
    store: backupStore,
    backupKeyPrefix: "crd-snapshots/test",
    backupRefPrefix: "s3://bucket",
    defaults: { cpuLimit: "1", memoryLimit: "2Gi" },
    absorbedByVersion: "test",
    now: new Date(),
  });
  check(
    "the next start recovers from the commit",
    recovered.status === "skipped" &&
      (await agentCount()) === 1 &&
      markerData.at(-1)?.store === "postgres",
  );

  // TEST_SCENARIO: a database another install absorbed is refused even though its stamp and rows are complete: the report names the install, and a mismatch is a refusal before any write.
  await db.execute(
    sql`UPDATE control.agent_store SET absorb_report = jsonb_set(absorb_report, '{install,releaseName}', '"other-install"') WHERE id = 1`,
  );
  let foreignAbsorb = "";
  try {
    await absorbAgentStore({
      db,
      logger: { info: () => {}, warn: () => {}, error: () => {} } as never,
      listCustomObjects: async () => {
        throw new Error(
          "a foreign database must not list the custom resources",
        );
      },
      writeMarker: async () => {
        throw new Error("a foreign database must not write the marker");
      },
      readMarker: async () => null,
      install: INSTALL,
      store: null,
      backupKeyPrefix: "crd-snapshots/test",
      backupRefPrefix: "s3://bucket",
      defaults: { cpuLimit: "1", memoryLimit: "2Gi" },
      absorbedByVersion: "test",
      now: new Date(),
    });
  } catch (cause) {
    foreignAbsorb = reasonOf(cause);
  }
  check(
    "the absorb refuses a database another install absorbed",
    foreignAbsorb.includes("another install"),
    foreignAbsorb,
  );
  await db.execute(
    sql`UPDATE control.agent_store SET absorb_report = jsonb_set(absorb_report, '{install,releaseName}', '"platform"') WHERE id = 1`,
  );

  // TEST_SCENARIO: a cluster marker that names an absorbed store over a database with no stamp is refused: the rows it would import belong to another store.
  const stampBefore = await stamp();
  await db.execute(
    sql`UPDATE control.agent_store SET absorbed_at = NULL WHERE id = 1`,
  );
  let markerOverEmpty = "";
  try {
    await absorbAgentStore({
      db,
      logger: { info: () => {}, warn: () => {}, error: () => {} } as never,
      listCustomObjects: async () => [kubeAgent([])],
      writeMarker: async () => {},
      readMarker: async () => ({
        store: "postgres",
        "absorbed-at": "2026-01-01T00:00:00.000Z",
      }),
      install: INSTALL,
      store: null,
      backupKeyPrefix: "crd-snapshots/test",
      backupRefPrefix: "s3://bucket",
      defaults: { cpuLimit: "1", memoryLimit: "2Gi" },
      absorbedByVersion: "test",
      now: new Date(),
    });
  } catch (cause) {
    markerOverEmpty = reasonOf(cause);
  }
  check(
    "the absorb refuses an absorbed marker over a database with no stamp",
    markerOverEmpty.includes("holds no absorb stamp"),
    markerOverEmpty,
  );
  await db.execute(
    sql`UPDATE control.agent_store SET absorbed_at = ${stampBefore} WHERE id = 1`,
  );

  // TEST_SCENARIO: the barrier opens only when the Lease's holder is the controller that recorded its anchor pass, and it never waits again once it has recorded the switch.
  const holder = "controller-pod-1";
  await db.execute(
    sql`UPDATE control.agent_store SET controller_holder = ${holder}, anchors_ensured_at = now() WHERE id = 1`,
  );
  await db.execute(
    sql`UPDATE control.agent_store SET switch_completed_at = NULL WHERE id = 1`,
  );
  const leases = {
    readNamespacedLease: async () => ({ spec: { holderIdentity: holder } }),
  } as unknown as CoordinationV1Api;
  const rawStamp = await stamp();
  const storeStamp =
    rawStamp === null
      ? ""
      : typeof rawStamp === "string"
        ? new Date(rawStamp).toISOString()
        : rawStamp.toISOString();
  let foreignRefused = false;
  try {
    await passCutoverBarrier({
      db,
      leases,
      namespace: "test",
      leaseName: "platform-controller",
      markerAbsorbedAt: "2026-01-01T00:00:00.000Z",
      log: () => {},
      pollMs: 1,
      deadlineMs: 100,
    });
  } catch {
    foreignRefused = true;
  }
  check(
    "the barrier refuses a database the marker does not name",
    foreignRefused,
  );
  const passed = await passCutoverBarrier({
    db,
    leases,
    namespace: "test",
    leaseName: "platform-controller",
    markerAbsorbedAt: storeStamp,
    log: () => {},
    pollMs: 1,
    deadlineMs: 1_000,
  });
  const switchedRows = await db.execute(
    sql`SELECT switch_completed_at FROM control.agent_store WHERE id = 1`,
  );
  check(
    "the barrier passes for the recorded holder and records the switch",
    passed === "passed" &&
      (
        switchedRows as unknown as Array<{ switch_completed_at: Date | null }>
      )[0]?.switch_completed_at != null,
  );
  const again = await passCutoverBarrier({
    db,
    leases: {
      readNamespacedLease: async () => {
        throw new Error("a completed switch must not read the Lease again");
      },
    } as unknown as CoordinationV1Api,
    namespace: "test",
    leaseName: "platform-controller",
    markerAbsorbedAt: storeStamp,
    log: () => {},
    pollMs: 1,
    deadlineMs: 100,
  });
  check("a completed switch never waits again", again === "already");

  await db.execute(sql`DELETE FROM control.agents`);
  await db.execute(sql`DELETE FROM control.user_budgets`);
  await db.execute(sql`DELETE FROM control.crd_snapshots`);
  await db.execute(sql`DELETE FROM control.agent_store`);
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
  .finally(async () => {
    await other.sql.end({ timeout: 5 });
    await client.end({ timeout: 5 });
  });
