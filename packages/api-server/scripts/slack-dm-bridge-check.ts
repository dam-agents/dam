/**
 * TEST_OVERVIEW: the DM Bridge's Postgres record on a real database. The unit
 * suite models the store and the service; what only a real server can show is
 * that the statements settle what they promise — a pairing inserts an identity
 * link once and never moves it, a Keycloak sign-in promotes that row, a
 * conversation's default is claimed only while it is vacant, two workspaces
 * that share a conversation id keep separate bindings, and the record answers
 * whether this call created it, blocks turns once revoked and offers the
 * greeting to exactly one caller.
 *
 * Run by `mise run //packages/api-server:test:slack-dm-bridge` against a
 * disposable database with this branch's migrations applied.
 */
import { createDb, sql } from "db";
import {
  deleteEmailIdentityLink,
  findExternalLinksByIdentity,
  findIdentityByExternalUser,
  insertEmailIdentityLinkIfAbsent,
  upsertIdentityLink,
} from "../src/modules/channels/infrastructure/identity-links-repository.js";
import { createSlackDmBridgesRepository } from "../src/modules/channels/infrastructure/slack-dm-bridges-repository.js";
import { findSlackBindingsByChannelId } from "../src/modules/agents/infrastructure/channel-bindings-repository.js";

const url = process.env.SLACK_DM_BRIDGE_DATABASE_URL;
if (!url) {
  process.stderr.write(
    "SLACK_DM_BRIDGE_DATABASE_URL must point at a disposable database with the migrations applied\n",
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

const OWNER = "sub-bridge-check";
const OTHER_OWNER = "sub-bridge-check-other";
const AGENT = "agent-bridge-check";
const OTHER_AGENT = "agent-bridge-check-other";
const TEAM = "T0BRIDGECHECK";
const OTHER_TEAM = "T0BRIDGECHECK2";
const USER = "U0BRIDGECHECK";
const OTHER_USER = "U0BRIDGECHECK2";
const PROBE_USER = "U0BRIDGECHECK3";
const DELETE_USER = "U0BRIDGECHECK4";
const RACE_USER = "U0BRIDGECHECK5";
const RACE_AGENT = "agent-bridge-check-race";
const DM = "D0BRIDGECHECK";

const bridges = createSlackDmBridgesRepository(db);
const identity = {
  insert: insertEmailIdentityLinkIfAbsent(db),
  upsert: upsertIdentityLink(db),
  find: findIdentityByExternalUser(db),
  deleteEmail: deleteEmailIdentityLink(db),
};

async function cleanup(): Promise<void> {
  await db.execute(
    sql`delete from slack_dm_bridges where agent_id in (${AGENT}, ${OTHER_AGENT}, ${RACE_AGENT})`,
  );
  await db.execute(
    sql`delete from channels where agent_id in (${AGENT}, ${OTHER_AGENT}, ${RACE_AGENT})`,
  );
  await db.execute(
    sql`delete from identity_links where external_user_id in (${USER}, ${OTHER_USER}, ${PROBE_USER}, ${DELETE_USER}, ${RACE_USER})`,
  );
}

async function main(): Promise<void> {
  await cleanup();

  check(
    "a pairing inserts the link",
    (await identity.insert("slack", USER, OWNER, TEAM)) === true,
  );
  check(
    "a second pairing inserts nothing",
    (await identity.insert("slack", USER, OWNER, TEAM)) === false,
  );
  check(
    "and the row is the pairing's",
    (await identity.find("slack", USER))?.keycloakSub === OWNER,
  );
  check(
    "a pairing of the same account by another person inserts nothing",
    (await identity.insert("slack", USER, OTHER_OWNER, TEAM)) === false,
  );
  check(
    "so the link still belongs to the first owner",
    (await identity.find("slack", USER))?.keycloakSub === OWNER,
  );

  await identity.upsert("slack", USER, OWNER, TEAM);
  check(
    "a sign-in promotes the pairing to a proven link",
    (await identity.find("slack", USER))?.source === "oauth",
  );

  await identity.insert("slack", PROBE_USER, OWNER, null);
  check(
    "an owner's links come back workspace first, so a destination does not move between reads",
    (await findExternalLinksByIdentity(db)("slack", OWNER))[0]?.teamId === TEAM,
  );

  const first = await bridges.settleConnect({
    ownerSub: OWNER,
    agentId: AGENT,
    teamId: TEAM,
    dmChannelId: DM,
    slackUserId: USER,
    insertEmailLink: false,
  });
  check("a connect settles a binding and a record", first.ok === true);
  check(
    "and this call created both",
    first.ok && first.binding.created && first.bridge.created,
  );
  check("and the DM's default is its own", first.ok && first.binding.isDefault);

  const bindings = await findSlackBindingsByChannelId(db)(DM);
  check(
    "the binding carries the workspace it was proven in",
    bindings.length === 1 && bindings[0]?.teamId === TEAM,
    JSON.stringify(bindings),
  );

  const second = await bridges.settleConnect({
    ownerSub: OWNER,
    agentId: AGENT,
    teamId: TEAM,
    dmChannelId: DM,
    slackUserId: USER,
    insertEmailLink: false,
  });
  check(
    "a second connect creates nothing and says so",
    second.ok && !second.binding.created && !second.bridge.created,
  );
  check(
    "and keeps the default where it is",
    second.ok && second.binding.isDefault,
  );

  await identity.insert("slack", OTHER_USER, OTHER_OWNER, OTHER_TEAM);
  const otherTeam = await bridges.settleConnect({
    ownerSub: OTHER_OWNER,
    agentId: OTHER_AGENT,
    teamId: OTHER_TEAM,
    dmChannelId: DM,
    slackUserId: OTHER_USER,
    insertEmailLink: false,
  });
  check(
    "the same conversation id in another workspace is its own binding",
    otherTeam.ok && otherTeam.binding.created && otherTeam.binding.isDefault,
  );
  check(
    "and the first workspace's binding is untouched",
    (await findSlackBindingsByChannelId(db)(DM)).filter(
      (b) => b.teamId === TEAM,
    ).length === 1,
  );

  const vacant = await bridges.settleConnect({
    ownerSub: OWNER,
    agentId: OTHER_AGENT,
    teamId: TEAM,
    dmChannelId: DM,
    slackUserId: USER,
    insertEmailLink: false,
  });
  check(
    "a second agent joins beside the default without taking it",
    vacant.ok && vacant.binding.created && !vacant.binding.isDefault,
  );

  /* UNIT_BOUNDARY_DESCRIPTION: two connects can claim at the same moment, and
   * exactly one of them may post; the greeting columns and the claim token are
   * what make that true under real SQL rather than in one process's memory. */
  const claims = await Promise.all([
    bridges.claimHello(AGENT, TEAM, DM, USER),
    bridges.claimHello(AGENT, TEAM, DM, USER),
    bridges.claimHello(AGENT, TEAM, DM, USER),
  ]);
  const winners = claims.filter((token) => token !== null);
  check(
    "concurrent connects win the greeting exactly once",
    winners.length === 1,
    JSON.stringify(claims),
  );
  const winner = winners[0]!;
  check(
    "a claim that lost cannot record the greeting",
    (await Promise.all([
      bridges.recordHello(AGENT, TEAM, DM, USER, "not-the-token"),
      bridges.releaseHello(AGENT, TEAM, DM, USER, "not-the-token"),
    ])).every((applied) => applied === false),
  );
  check(
    "the winning claim records it",
    (await bridges.recordHello(AGENT, TEAM, DM, USER, winner)) === true,
  );
  check(
    "a recorded greeting is never repeated",
    (await bridges.claimHello(AGENT, TEAM, DM, USER)) === null,
  );

  /* UNIT_BOUNDARY_DESCRIPTION: a claim nobody finished goes stale, and the
   * attempt that takes it over owns the bookkeeping — the earlier sender can
   * neither record nor release the greeting any more. */
  await db.execute(
    sql`update slack_dm_bridges set hello_posted_at = null, hello_claim_token = 'stale-token',
        hello_claimed_at = now() - interval '10 minutes'
      where agent_id = ${AGENT} and team_id = ${TEAM} and dm_channel_id = ${DM}`,
  );
  const takenOver = await bridges.claimHello(AGENT, TEAM, DM, USER);
  check("a stale claim is taken over", takenOver !== null && takenOver !== "stale-token");
  check(
    "the superseded sender cannot record its late success",
    (await bridges.recordHello(AGENT, TEAM, DM, USER, "stale-token")) === false,
  );
  check(
    "nor release the new claim",
    (await bridges.releaseHello(AGENT, TEAM, DM, USER, "stale-token")) === false,
  );
  check(
    "and the new claim still owns the greeting",
    (await bridges.recordHello(AGENT, TEAM, DM, USER, takenOver!)) === true,
  );

  const revokeGeneration = (await bridges.find(AGENT, TEAM, DM))!.generation;
  const revoked = await bridges.revokeBridge({
    agentId: AGENT,
    teamId: TEAM,
    dmChannelId: DM,
    slackUserId: USER,
    ownerSub: OWNER,
    generation: revokeGeneration,
  });
  check(
    "a revoke releases the binding, its threads and the email link",
    revoked.outcome === "revoked" && revoked.linksRemoved === 0,
    JSON.stringify(revoked),
  );
  check(
    "and the record says so",
    (await bridges.find(AGENT, TEAM, DM))?.state === "revoked",
  );
  check(
    "a revoked record keeps blocking",
    (await bridges.blocked(AGENT, TEAM, DM)) === true,
  );
  check(
    "a stale revoke deletes nothing",
    (await bridges.revokeBridge({
      agentId: AGENT,
      teamId: TEAM,
      dmChannelId: DM,
      slackUserId: USER,
      ownerSub: OWNER,
      generation: revokeGeneration,
    })).outcome === "superseded",
  );

  /* UNIT_BOUNDARY_DESCRIPTION: the reconnect-before-delete window — a revoke
   * read at one generation, a connect that opens the next, and the revoke then
   * running: nothing of the reconnect may be deleted. */
  const reconnect = await bridges.settleConnect({
    ownerSub: OWNER,
    agentId: AGENT,
    teamId: TEAM,
    dmChannelId: DM,
    slackUserId: USER,
    insertEmailLink: false,
  });
  check(
    "a new connect reopens the same record at a new generation",
    reconnect.ok &&
      !reconnect.bridge.created &&
      reconnect.bridge.generation > revokeGeneration &&
      (await bridges.blocked(AGENT, TEAM, DM)) === false,
  );
  const staleRevoke = await bridges.revokeBridge({
    agentId: AGENT,
    teamId: TEAM,
    dmChannelId: DM,
    slackUserId: USER,
    ownerSub: OWNER,
    generation: revokeGeneration,
  });
  check(
    "a revoke read before a reconnect deletes nothing of it",
    staleRevoke.outcome === "superseded" &&
      (await bridges.bindingsInConversation(TEAM, DM)).some(
        (binding) => binding.agentId === AGENT,
      ) &&
      (await bridges.find(AGENT, TEAM, DM))?.state === "active",
  );

  /* UNIT_BOUNDARY_DESCRIPTION: a sign-in that proves a different owner retires
   * the previous owner's Bridge in the same transaction, so the DM can no
   * longer reach their Agent even if the sign-in waited for a connect to
   * commit; the same owner signing in again leaves it working. */
  const reassign = createDb(url, { poolMax: 1 });
  const reassignLinks = upsertIdentityLink(reassign.db);
  await reassignLinks("slack", USER, OTHER_OWNER, TEAM);
  check(
    "a sign-in for another owner closes the previous owner's Bridge",
    (await bridges.find(AGENT, TEAM, DM))?.state === "revoking",
  );
  check(
    "and the DM stops admitting turns",
    (await bridges.blocked(AGENT, TEAM, DM)) === true,
  );

  await bridges.settleConnect({
    ownerSub: OTHER_OWNER,
    agentId: AGENT,
    teamId: TEAM,
    dmChannelId: DM,
    slackUserId: USER,
    insertEmailLink: false,
  });
  await reassignLinks("slack", USER, OTHER_OWNER, TEAM);
  check(
    "a sign-in by the same owner leaves the Bridge working",
    (await bridges.find(AGENT, TEAM, DM))?.state === "active",
  );

  /* UNIT_BOUNDARY_DESCRIPTION: whichever of the two commits first — the sign-in
   * that proves a new owner, or the connect that settles the old one — a record
   * must never be `active` for an owner the link no longer names. Five rounds
   * start each of them in turn, which is the interleaving the lock and the
   * reassignment have to survive. */
  let unsafe = 0;
  for (let round = 0; round < 5; round += 1) {
    await reassignLinks("slack", USER, OWNER, TEAM);
    const connect = () =>
      bridges.settleConnect({
        ownerSub: OWNER,
        agentId: AGENT,
        teamId: TEAM,
        dmChannelId: DM,
        slackUserId: USER,
        insertEmailLink: false,
      });
    const signIn = () => reassignLinks("slack", USER, OTHER_OWNER, TEAM);
    const both =
      round % 2 === 0
        ? await Promise.all([connect(), signIn()])
        : await Promise.all([signIn(), connect()]);
    void both;
    const link = await identity.find("slack", USER);
    const record = await bridges.find(AGENT, TEAM, DM);
    if (record?.state === "active" && record.ownerSub !== link?.keycloakSub)
      unsafe += 1;
  }
  check(
    "a sign-in racing a connect never leaves another owner's Bridge open",
    unsafe === 0,
  );

  /* UNIT_BOUNDARY_DESCRIPTION: the race that has no row to lock — a connect
   * that inserts the first link for a person at the same moment a sign-in
   * proves who they are. Rounds start each of them in turn and, after both, an
   * active record must belong to the owner the link actually names. */
  let wrongOwner = 0;
  for (let round = 0; round < 6; round += 1) {
    await db.execute(
      sql`delete from slack_dm_bridges where agent_id = ${RACE_AGENT}`,
    );
    await db.execute(
      sql`delete from channels where agent_id = ${RACE_AGENT}`,
    );
    await db.execute(
      sql`delete from identity_links where external_user_id = ${RACE_USER}`,
    );
    const connect = () =>
      bridges.settleConnect({
        ownerSub: OWNER,
        agentId: RACE_AGENT,
        teamId: TEAM,
        dmChannelId: DM,
        slackUserId: RACE_USER,
        insertEmailLink: true,
      });
    const prove = () => reassignLinks("slack", RACE_USER, OTHER_OWNER, TEAM);
    const both =
      round % 2 === 0
        ? await Promise.all([connect(), prove()])
        : await Promise.all([prove(), connect()]);
    void both;
    const link = await identity.find("slack", RACE_USER);
    const record = await bridges.find(RACE_AGENT, TEAM, DM);
    if (record?.state === "active" && record.ownerSub !== link?.keycloakSub)
      wrongOwner += 1;
  }
  check(
    "a sign-in racing the first link never leaves another owner's Bridge open",
    wrongOwner === 0,
  );
  await reassign.sql.end({ timeout: 5 });
}

await main()
  .catch((cause) => {
    failures.push(
      `the run stopped: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
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
    await client.end({ timeout: 5 });
  });
