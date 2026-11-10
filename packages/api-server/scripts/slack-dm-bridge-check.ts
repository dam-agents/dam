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
    sql`delete from slack_dm_bridges where agent_id in (${AGENT}, ${OTHER_AGENT})`,
  );
  await db.execute(
    sql`delete from channels where agent_id in (${AGENT}, ${OTHER_AGENT})`,
  );
  await db.execute(
    sql`delete from identity_links where external_user_id in (${USER}, ${OTHER_USER}, ${PROBE_USER})`,
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

  check(
    "the greeting is claimed once",
    (await bridges.claimHello(AGENT, TEAM, DM)) === true &&
      (await bridges.claimHello(AGENT, TEAM, DM)) === false,
  );
  await bridges.clearHello(AGENT, TEAM, DM);
  check(
    "and is offered again after a failed greeting",
    (await bridges.claimHello(AGENT, TEAM, DM)) === true,
  );

  await bridges.setState(AGENT, TEAM, DM, "revoking");
  check(
    "a revoking record blocks turns",
    (await bridges.blocked(AGENT, TEAM, DM)) === true,
  );
  check(
    "while another workspace's record is unaffected",
    (await bridges.blocked(AGENT, OTHER_TEAM, DM)) === false,
  );

  await bridges.releaseBinding(AGENT, TEAM, DM);
  check(
    "releasing a binding removes only that agent's row in that workspace",
    (await bridges.bindingsInConversation(TEAM, DM)).every(
      (b) => b.agentId !== AGENT,
    ) &&
      (await bridges.bindingsInConversation(TEAM, DM)).some(
        (b) => b.agentId === OTHER_AGENT,
      ),
  );
  check(
    "and leaves the same conversation id in the other workspace alone",
    (await bridges.bindingsInConversation(OTHER_TEAM, DM)).length === 1,
  );

  await identity.deleteEmail("slack", USER, OTHER_TEAM);
  check(
    "an email link is deleted only in the workspace it names",
    (await identity.find("slack", USER)) !== null,
  );

  await bridges.setState(AGENT, TEAM, DM, "revoked");
  check(
    "a revoked record keeps blocking",
    (await bridges.blocked(AGENT, TEAM, DM)) === true,
  );

  const reconnect = await bridges.settleConnect({
    ownerSub: OWNER,
    agentId: AGENT,
    teamId: TEAM,
    dmChannelId: DM,
    slackUserId: USER,
    insertEmailLink: false,
  });
  check(
    "a new connect reopens the same record",
    reconnect.ok &&
      !reconnect.bridge.created &&
      reconnect.bridge.state === "active" &&
      (await bridges.blocked(AGENT, TEAM, DM)) === false,
  );
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
