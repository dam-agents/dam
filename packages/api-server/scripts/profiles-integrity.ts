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
import { createSubPseudonymizer } from "../src/core/sub-pseudonymizer.js";
import { createProfilesRepository } from "../src/modules/profiles/infrastructure/profiles-repository.js";
import { createProfilesService } from "../src/modules/profiles/services/profiles-service.js";
import { createProfileResolver } from "../src/modules/profiles/services/profile-resolution.js";
import { createSessionPairRepo } from "../src/modules/harness-config/infrastructure/session-pair-repo.js";
import { createSchedulesRepository } from "../src/modules/schedules/infrastructure/schedules-repository.js";
import { createChannelPairResolver } from "../src/modules/channels/services/channel-pair-resolver.js";
import {
  isAgentRowDeleted,
  markAgentDeleted,
  upsertAgent,
} from "../src/modules/usage/infrastructure/agents-postgres-repository.js";

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
/* UNIT_BOUNDARY_DESCRIPTION: the Agent store keeps owners pseudonymised, so the
 * fixtures go in through the same writer and the same hash as production; a
 * raw sub here would hide an owner-key mismatch instead of failing on it. */
const pseudo = createSubPseudonymizer("profiles-integrity-check");
const registerAgent = upsertAgent(db, pseudo);

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
  const repo = createProfilesRepository(db, pseudo);
  return {
    repo,
    resolver: createProfileResolver({ repo }),
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
  await registerAgent({ id, ownerSub: owner });
  const columns = Object.entries(values);
  if (columns.length > 0)
    await db.execute(sql`
      UPDATE agents
      SET ${sql.join(
        columns.map(
          ([key, value]) =>
            sql`${sql.raw(`"${key}"`)} = ${
              value && typeof value === "object" && !(value instanceof Date)
                ? sql`${JSON.stringify(value)}::jsonb`
                : sql`${value}`
            }`,
        ),
        sql`, `,
      )}
      WHERE id = ${id}
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
    renamed.profile.seeded === true &&
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

  process.stdout.write("\nsoft-deleted agents\n");
  const softProfile = await service.create({
    name: "Soft",
    harness: "claude-code",
    providerTemplate: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
    model: MODEL,
  });
  const softAgent = await insertAgent(owner, { session_profile: softProfile.id });
  await markAgentDeleted(db)(softAgent);
  const softDeleted = await rejects(() => service.delete(softProfile.id));
  check(
    "a profile an agent held is deletable once that agent is deleted",
    softDeleted === null,
    String(softDeleted),
  );

  process.stdout.write("\na profile named Default\n");
  const seedOwner = unique("owner");
  const seedService = serviceFor(seedOwner).service;
  const namedDefault = await rejects(() =>
    seedService.create({
      name: "Default",
      harness: "claude-code",
      providerTemplate: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
      model: MODEL,
    }),
  );
  const seededFirst = await seedService.list();
  check(
    "creating a profile named Default after the seed is refused, and the seed stands",
    namedDefault === "CONFLICT" &&
      seededFirst.filter((p) => p.seeded).length === 1,
    JSON.stringify({ namedDefault, seededFirst: seededFirst.map((p) => [p.name, p.seeded]) }),
  );

  process.stdout.write("\nresolving a stored reference\n");
  const seamProfile = await service.create({
    name: "Seam",
    harness: "claude-code",
    providerTemplate: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
    model: MODEL,
  });
  await db.execute(
    sql`INSERT INTO connection_grants (connection_id, agent_id) VALUES (${provider}, ${boundAgent}) ON CONFLICT DO NOTHING`,
  );
  const resolver = createProfileResolver({ repo });
  const pairRepo = createSessionPairRepo(db, resolver);
  await db.execute(
    sql`UPDATE agents SET session_profile = ${seamProfile.id}, session_pair = NULL WHERE id = ${boundAgent}`,
  );
  const resolvedDefaults = await pairRepo.readSaved(boundAgent);
  check(
    "the repository returns the pair a stored reference resolves to",
    resolvedDefaults.chat?.model === MODEL &&
      resolvedDefaults.chat?.harness === "claude-code",
    JSON.stringify(resolvedDefaults.chat),
  );
  const wrote = await pairRepo.writeIfEmpty(boundAgent, {
    harness: "claude-code",
    provider,
    model: MODEL,
  });
  const stillProfile = await pairRepo.readReferences(boundAgent);
  check(
    "the one-time conversion leaves an Agent on its profile alone",
    !wrote && stillProfile.sessionProfile === seamProfile.id,
    JSON.stringify({ wrote, stillProfile }),
  );
  await pairRepo.write(boundAgent, "chat", {
    harness: "claude-code",
    provider,
    model: MODEL,
  });
  const afterPick = await pairRepo.readReferences(boundAgent);
  const afterPickPair = await pairRepo.read(boundAgent, "chat");
  check(
    "a custom chat pick detaches the Agent from its profile",
    afterPick.sessionProfile === null && afterPickPair?.model === MODEL,
    JSON.stringify({ afterPick, afterPickPair }),
  );

  await db.execute(
    sql`UPDATE agents SET session_profile = ${seamProfile.id}, session_pair = NULL WHERE id = ${boundAgent}`,
  );
  const scheduleWithProfile = await insertSchedule(
    owner,
    boundAgent,
    seamProfile.id,
  );
  const scheduleRepo = createSchedulesRepository(db, resolver);
  const readSchedule = await scheduleRepo.get(scheduleWithProfile, owner);
  check(
    "a schedule's stored profile is read as the pair it stands for",
    readSchedule?.spec.harness === "claude-code" &&
      readSchedule?.spec.model === MODEL,
    JSON.stringify(readSchedule?.spec),
  );
  await db.execute(
    sql`UPDATE schedules SET spec = spec - 'profile' WHERE id = ${scheduleWithProfile}`,
  );

  process.stdout.write("\na restored Agent\n");
  const restoreOwner = unique("owner");
  const restore = serviceFor(restoreOwner);
  const restoreConnection = await insertConnection(
    restoreOwner,
    "curve-bender-deployment",
  );
  const restoreAgent = await insertAgent(restoreOwner);
  await db.execute(
    sql`INSERT INTO connection_grants (connection_id, agent_id) VALUES (${restoreConnection}, ${restoreAgent}) ON CONFLICT DO NOTHING`,
  );
  await markAgentDeleted(db)(restoreAgent);
  await registerAgent({ id: restoreAgent, ownerSub: restoreOwner });
  const restored = await createSessionPairRepo(db, restore.resolver).readReferences(
    restoreAgent,
  );
  await restore.service.bindDefaultAgentProfile({
    agentId: restoreAgent,
    harness: "claude-code",
    grantedConnectionIds: [restoreConnection],
  });
  const afterRestore = await createSessionPairRepo(
    db,
    restore.resolver,
  ).readReferences(restoreAgent);
  check(
    "a restored Agent with neither shape is bound to the seeded Default",
    restored.sessionProfile === null && afterRestore.sessionProfile !== null,
    JSON.stringify({ restored, afterRestore }),
  );
  await db.execute(
    sql`DELETE FROM connection_grants WHERE agent_id = ${restoreAgent}`,
  );
  await db.execute(
    sql`DELETE FROM agents WHERE owner_sub = ${pseudo.hashSub(restoreOwner)}`,
  );
  await db.execute(sql`DELETE FROM connections WHERE owner = ${restoreOwner}`);
  await db.execute(sql`DELETE FROM profile_seeds WHERE owner = ${restoreOwner}`);
  await db.execute(sql`DELETE FROM profiles WHERE owner = ${restoreOwner}`);

  process.stdout.write("\nwhat a boot pass treats as a restore\n");
  const liveAgent = await insertAgent(owner);
  const deletedAgent = await insertAgent(owner);
  await markAgentDeleted(db)(deletedAgent);
  check(
    "only a row that was soft-deleted reads as restored",
    (await isAgentRowDeleted(db)(deletedAgent)) === true &&
      (await isAgentRowDeleted(db)(liveAgent)) === false &&
      (await isAgentRowDeleted(db)(unique("absent"))) === false,
    "predicate",
  );

  process.stdout.write("\nownership at the write\n");
  const ownProfile = (await service.list())[0]!;
  const foreign = await resolver.resolveStored({
    profileId: ownProfile.id,
    agentId: boundAgent,
    owner: unique("someone-else"),
  });
  check(
    "resolving with another owner's subject refuses the profile",
    foreign === null,
    JSON.stringify(foreign?.profile.name),
  );
  const own = await resolver.resolveStored({
    profileId: ownProfile.id,
    agentId: boundAgent,
    owner,
  });
  check(
    "resolving with the profile's own owner answers",
    own !== null,
    "refused",
  );
  const slotOwner = unique("owner");
  const slotService = serviceFor(slotOwner);
  const slotAgent = await insertAgent(slotOwner);
  const slotConnection = await insertConnection(slotOwner, "curve-bender-deployment");
  await db.execute(
    sql`INSERT INTO connection_grants (connection_id, agent_id) VALUES (${slotConnection}, ${slotAgent}) ON CONFLICT DO NOTHING`,
  );
  const slotProfile = await slotService.service.create({
    name: "Sub agents",
    harness: "claude-code",
    providerTemplate: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
    model: MODEL,
  });
  /* UNIT_BOUNDARY_DESCRIPTION: the slot is written here directly, as the checked write would, so the read is what this proves. */
  const slotRepo = createSessionPairRepo(db, slotService.resolver);
  /* UNIT_BOUNDARY_DESCRIPTION: the slot augments a chat default; a slot alone
   * leaves the Agent with none, which every reader already reports. */
  await db.execute(
    sql`UPDATE agents SET platform_subagent_profile = ${slotProfile.id},
        session_pair = ${JSON.stringify({
          harness: "claude-code",
          provider: slotConnection,
          model: MODEL,
        })}::jsonb
        WHERE id = ${slotAgent}`,
  );
  const slotRead = await slotRepo.readSaved(slotAgent);
  check(
    "the platform sub-agent slot resolves into harness and model",
    slotRead.chat?.settings?.["platformSubagent.harness"] === "claude-code" &&
      slotRead.chat?.settings?.["platformSubagent.model"] === MODEL,
    JSON.stringify(slotRead.chat?.settings),
  );
  await db.execute(sql`DELETE FROM agents WHERE owner_sub = ${pseudo.hashSub(slotOwner)}`);
  await db.execute(sql`DELETE FROM connections WHERE owner = ${slotOwner}`);
  await db.execute(sql`DELETE FROM profile_seeds WHERE owner = ${slotOwner}`);
  await db.execute(sql`DELETE FROM profiles WHERE owner = ${slotOwner}`);

  process.stdout.write("\na channel's own profile\n");
  const channelOwner = unique("owner");
  const channelService = serviceFor(channelOwner);
  const channelAgent = await insertAgent(channelOwner);
  const channelConnection = await insertConnection(
    channelOwner,
    "curve-bender-deployment",
  );
  await db.execute(
    sql`INSERT INTO connection_grants (connection_id, agent_id) VALUES (${channelConnection}, ${channelAgent}) ON CONFLICT DO NOTHING`,
  );
  const channelProfile = await channelService.service.create({
    name: "Support",
    harness: "claude-code",
    providerTemplate: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
    model: MODEL,
  });
  await db.execute(
    sql`INSERT INTO channels (agent_id, owner, type, config, profile_id)
        VALUES (${channelAgent}, ${channelOwner}, 'slack',
                ${JSON.stringify({ slackChannelId: "C-1" })}::jsonb, ${channelProfile.id})`,
  );
  await db.execute(
    sql`INSERT INTO channels (agent_id, owner, type, config)
        VALUES (${channelAgent}, ${channelOwner}, 'slack',
                ${JSON.stringify({ slackChannelId: "C-2" })}::jsonb)`,
  );
  const channelPair = createChannelPairResolver({
    db,
    resolver: channelService.resolver,
  });
  check(
    "a channel with a profile turns on it, and one without yields none",
    (await channelPair(channelAgent, { type: "slack", slackChannelId: "C-1" }))
      ?.model === MODEL &&
      (await channelPair(channelAgent, {
        type: "slack",
        slackChannelId: "C-2",
      })) === null,
    "resolver",
  );
  await db.execute(sql`DELETE FROM channels WHERE owner = ${channelOwner}`);
  await db.execute(sql`DELETE FROM agents WHERE owner_sub = ${pseudo.hashSub(channelOwner)}`);
  await db.execute(sql`DELETE FROM profile_seeds WHERE owner = ${channelOwner}`);
  await db.execute(sql`DELETE FROM profiles WHERE owner = ${channelOwner}`);

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

  await db.execute(sql`DELETE FROM agents WHERE owner_sub = ${pseudo.hashSub(owner)}`);
  await db.execute(sql`DELETE FROM schedules WHERE owner = ${owner}`);
  await db.execute(sql`DELETE FROM connections WHERE owner = ${owner}`);
  await db.execute(sql`DELETE FROM profile_seeds WHERE owner = ${owner}`);
  await db.execute(sql`DELETE FROM profiles WHERE owner = ${owner}`);
  await db.execute(sql`DELETE FROM agents WHERE owner_sub = ${pseudo.hashSub(otherOwner)}`);
  await db.execute(sql`DELETE FROM profile_seeds WHERE owner = ${seedOwner}`);
  await db.execute(sql`DELETE FROM profiles WHERE owner = ${seedOwner}`);
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
