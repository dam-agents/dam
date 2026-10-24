/**
 * TEST_OVERVIEW: real-PostgreSQL check for what a profile reference must guarantee, run by
 * `mise run //packages/api-server:test:profiles-integrity` against a disposable database with this
 * branch's migrations applied. It drives the real repository and service, and asserts the
 * constraints the unit tests cannot reach: the seed marker under concurrency, the XOR check, the
 * restrictive foreign keys, and usage counting across a JSON reference.
 */
import { createDb, sql } from "db";
import {
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  CURVE_BENDER_WORK_MODEL,
  aliasForTemplateId,
} from "api-server-api";
import { createProfilesRepository } from "../src/modules/profiles/infrastructure/profiles-repository.js";
import { createSessionPairRepo } from "../src/modules/harness-config/infrastructure/session-pair-repo.js";
import { createProfilesService } from "../src/modules/profiles/services/profiles-service.js";

const url = process.env.PROFILES_DATABASE_URL;
if (!url) {
  process.stderr.write(
    "PROFILES_DATABASE_URL must point at a disposable database with the migrations applied\n",
  );
  process.exit(2);
}

const MODEL = `${aliasForTemplateId(CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID)}/${CURVE_BENDER_WORK_MODEL}`;
const catalog = {
  default: "claude-code" as const,
  harnesses: [
    {
      name: "claude-code" as const,
      displayName: "Claude",
      providers: ["curve-bender" as const],
      tags: [],
      experimental: false,
    },
  ],
};

const { db, sql: client } = createDb(url);

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

function serviceFor(owner: string) {
  const repo = createProfilesRepository(db);
  return {
    repo,
    service: createProfilesService({
      repo,
      owner,
      catalog,
      seededProvider: {
        providerTemplate: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
        model: MODEL,
      },
    }),
  };
}

async function insertAgent(owner: string, values: Record<string, unknown> = {}) {
  const id = unique("agent");
  const columns = {
    id,
    owner_sub: owner,
    ...values,
  };
  await db.execute(sql`
    INSERT INTO agents (${sql.raw(Object.keys(columns).map((k) => `"${k}"`).join(", "))})
    VALUES (${sql.join(
      Object.values(columns).map((value) =>
        value && typeof value === "object" && !(value instanceof Date)
          ? sql`${JSON.stringify(value)}::jsonb`
          : sql`${value}`,
      ),
      sql`, `,
    )})
  `);
  return id;
}

async function insertConnection(owner: string, templateId: string) {
  const id = unique("conn");
  await db.execute(sql`
    INSERT INTO connections (id, owner, template_id, name, inputs, auth, contributions)
    VALUES (${id}, ${owner}, ${templateId}, ${unique("CurveBender")}, '{}'::jsonb,
            ${JSON.stringify({ kind: "header", valueRef: { ref: id, field: "key" } })}::jsonb,
            '[]'::jsonb)
  `);
  return id;
}

async function insertSchedule(owner: string, agentId: string, profile: string) {
  const id = unique("sched");
  await db.execute(sql`
    INSERT INTO schedules (id, agent_id, owner, name, spec, enabled)
    VALUES (${id}, ${agentId}, ${owner}, ${unique("Nightly")},
            ${JSON.stringify({
              version: "1",
              type: "cron",
              cron: "0 3 * * *",
              task: "check",
              profile,
              enabled: true,
              createdBy: "user",
            })}::jsonb,
            true)
  `);
  return id;
}

async function rejects(run: () => Promise<unknown>): Promise<string | null> {
  return run().then(
    () => null,
    (err: unknown) => {
      const e = err as { code?: string; cause?: { code?: string }; message?: string };
      return e.code ?? e.cause?.code ?? e.message ?? "error";
    },
  );
}

async function main() {
  const owner = unique("owner");
  const { service, repo } = serviceFor(owner);

  process.stdout.write("\nseed marker\n");
  const listed = await Promise.all([
    service.list(),
    service.list(),
    service.list(),
  ]);
  const seededCount = listed[0]!.filter((p) => p.seeded).length;
  check(
    "three concurrent lists seed exactly one Default",
    seededCount === 1 && listed.every((l) => l.length === 1),
    JSON.stringify(listed.map((l) => l.map((p) => p.name))),
  );
  const seeded = listed[0]![0]!;
  check(
    "the seeded profile names the shared CurveBender and its work model",
    seeded.harness === "claude-code" &&
      seeded.providerTemplate === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID &&
      seeded.model === MODEL,
    JSON.stringify(seeded),
  );

  const renamed = await service.update({ id: seeded.id, name: "Cheap" });
  const afterRename = await service.list();
  check(
    "a renamed seed stays the seeded one and is not seeded again",
    renamed.seeded === true &&
      afterRename.length === 1 &&
      afterRename[0]!.name === "Cheap",
    JSON.stringify(afterRename.map((p) => [p.name, p.seeded])),
  );

  await service.delete(seeded.id);
  const afterDelete = await service.list();
  check(
    "a deleted seed is not recreated by the next list",
    afterDelete.length === 0,
    JSON.stringify(afterDelete.map((p) => p.name)),
  );

  process.stdout.write("\nreferences\n");
  const profile = await service.create({
    name: "Review",
    harness: "claude-code",
    providerTemplate: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
    model: MODEL,
  });
  const provider = await insertConnection(owner, "curve-bender-deployment");

  const xorRejected = await rejects(() =>
    insertAgent(owner, {
      session_pair: { harness: "claude-code", provider, model: MODEL },
      session_profile: profile.id,
    }),
  );
  check(
    "an agent cannot hold a chat profile and an inline pair at once",
    xorRejected === "23514",
    String(xorRejected),
  );

  const boundAgent = await insertAgent(owner, { session_profile: profile.id });
  const usage = await service.usage(profile.id);
  check(
    "usage names the agent that points at it",
    usage.agents.length === 1 && usage.agents[0]!.slots.includes("chat"),
    JSON.stringify(usage.agents),
  );

  const schedule = await insertSchedule(owner, boundAgent, profile.id);
  const withSchedule = await repo.usageCounts(owner);
  check(
    "usage counts a schedule whose spec names the profile",
    withSchedule.get(profile.id)?.schedules === 1,
    JSON.stringify([...withSchedule]),
  );

  const deleteRefused = await rejects(() => service.delete(profile.id));
  check(
    "deleting a used profile is refused before the database sees it",
    deleteRefused === "PRECONDITION_FAILED",
    String(deleteRefused),
  );

  const fkRejected = await rejects(() =>
    db.execute(sql`DELETE FROM profiles WHERE id = ${profile.id}`),
  );
  check(
    "a raw delete behind the service is stopped by the foreign keys",
    fkRejected === "23503" && (await repo.get(owner, profile.id)) !== null,
    String(fkRejected),
  );

  const otherOwner = unique("owner");
  const other = serviceFor(otherOwner);
  const otherDelete = await rejects(() => other.service.delete(profile.id));
  const otherUsage = await rejects(() => other.service.usage(profile.id));
  check(
    "another owner can neither delete nor read this profile's usage",
    otherDelete === "NOT_FOUND" && otherUsage === "NOT_FOUND",
    JSON.stringify({ otherDelete, otherUsage }),
  );
  check(
    "another owner's usage counts do not include this profile",
    (await other.repo.usageCounts(otherOwner)).get(profile.id) === undefined,
    "counted",
  );

  process.stdout.write("\nthe chat default's two shapes\n");
  const second = await service.create({
    name: "Second",
    harness: "claude-code",
    providerTemplate: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
    model: MODEL,
  });
  const pairRepo = createSessionPairRepo(db);
  const profileAgent = await insertAgent(owner, { session_profile: second.id });
  const pair = {
    harness: "claude-code",
    provider,
    model: MODEL,
  };
  const wrote = await pairRepo.writeIfEmpty(profileAgent, pair);
  const chatOf = async (agentId: string) => {
    const rows = (await db.execute(sql`
      SELECT session_profile AS profile, session_pair AS pair
      FROM agents WHERE id = ${agentId}
    `)) as unknown as { profile: string | null; pair: unknown }[];
    return rows[0]!;
  };
  const afterConvert = await chatOf(profileAgent);
  check(
    "the first-hello conversion leaves an agent on its profile alone",
    !wrote && afterConvert.profile === second.id && afterConvert.pair === null,
    JSON.stringify({ wrote, afterConvert }),
  );
  await pairRepo.write(profileAgent, "chat", pair);
  const afterPick = await chatOf(profileAgent);
  check(
    "a custom chat pick detaches the agent from its profile",
    afterPick.profile === null && afterPick.pair !== null,
    JSON.stringify(afterPick),
  );
  await service.delete(second.id);

  process.stdout.write("\nunbinding\n");
  await db.execute(
    sql`UPDATE schedules SET spec = spec - 'profile' WHERE id = ${schedule}`,
  );
  await db.execute(
    sql`UPDATE agents SET session_profile = NULL WHERE id = ${boundAgent}`,
  );
  const deleted = await repo.deleteIfUnused(owner, profile.id);
  check(
    "an unreferenced profile deletes, and cannot be bound again afterwards",
    deleted.outcome === "deleted" &&
      (await rejects(() =>
        db.execute(
          sql`UPDATE agents SET session_profile = ${profile.id} WHERE id = ${boundAgent}`,
        ),
      )) === "23503",
    JSON.stringify(deleted),
  );

  await db.execute(sql`DELETE FROM agents WHERE owner_sub = ${owner}`);
  await db.execute(sql`DELETE FROM schedules WHERE owner = ${owner}`);
  await db.execute(sql`DELETE FROM connections WHERE owner = ${owner}`);
  await db.execute(sql`DELETE FROM profile_seeds WHERE owner = ${owner}`);
  await db.execute(sql`DELETE FROM profiles WHERE owner = ${owner}`);
  await db.execute(sql`DELETE FROM agents WHERE owner_sub = ${otherOwner}`);
  await db.execute(sql`DELETE FROM profile_seeds WHERE owner = ${otherOwner}`);
  await db.execute(sql`DELETE FROM profiles WHERE owner = ${otherOwner}`);
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
