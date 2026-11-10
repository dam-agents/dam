// TEST_OVERVIEW: The DM Bridge pairs an owner's verified email with their Slack account only inside operator-trusted workspaces, and every doubt is a refusal: an unverified or unreachable mailbox, an unknown scope grant, a guest, stranger, bot or deleted account, a mailbox match on a re-assigned address, a Slack account linked to another person or another workspace, or a conversation that is not the 1:1 with that person. A connect settles a durable record with the link it found and the binding it made — the DM's default only while it has none — and greets once; a re-connect reports what exists and retries a greeting that failed. A revoke works from that record, never from live Slack answers, survives a failure at any step and finishes on retry, and keeps an OAuth link and every unrelated binding. The store here models the database rules the suite has no live database for.
import { describe, expect, it } from "vitest";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type {
  SlackConversationLookup,
  SlackEmailUser,
} from "../../modules/channels/infrastructure/slack-gateway.js";
import type { ExternalLink } from "../../modules/channels/services/identity-link-service.js";
import type {
  SlackDmBridge,
  SlackDmSettleInput,
} from "../../modules/channels/infrastructure/slack-dm-bridges-repository.js";
import {
  createSlackDmBridgeService,
  createSlackDmRevoker,
  type SlackDmBridgePorts,
  type SlackDmBridgeStore,
} from "../../modules/channels/services/slack-dm-bridge-service.js";

const OWNER = "kc|owner";
const OTHER_OWNER = "kc|other";
const AGENT = "agent-1";
const TEAM = "T0TEAM";
const OTHER_TEAM = "T0OTHER";
const ORG = "E0ORG";
const REQUIRED_SCOPES = [
  "users:read",
  "users:read.email",
  "im:read",
  "im:write",
  "im:history",
  "chat:write",
];

function emailUser(overrides: Partial<SlackEmailUser> = {}): SlackEmailUser {
  return {
    id: "U0OWNER",
    teamId: TEAM,
    enterpriseId: ORG,
    enterpriseTeams: null,
    enterpriseIsGuest: null,
    email: "owner@example.com",
    deleted: false,
    isBot: false,
    isAppUser: false,
    isRestricted: false,
    isUltraRestricted: false,
    isStranger: null,
    ...overrides,
  };
}

/**
 * TEST_SCENARIO: The store contract the database owns, in memory: an email link
 * inserts and never moves, a link of another person or workspace refuses the
 * settle, the binding is created once and takes the DM's default only while it
 * has none, and the record answers whether this call created it.
 */
function createMemoryStore() {
  const links = new Map<
    string,
    { keycloakSub: string; source: "oauth" | "email"; teamId: string | null }
  >();
  const bindings: {
    agentId: string;
    owner: string;
    teamId: string;
    slackChannelId: string;
    isDefault: boolean;
  }[] = [];
  const bridges = new Map<string, SlackDmBridge>();
  const calls: string[] = [];
  let failAt: string | null = null;

  const key = (agentId: string, teamId: string, dm: string) =>
    `${agentId}|${teamId}|${dm}`;

  const store: SlackDmBridgeStore = {
    async settleConnect(input: SlackDmSettleInput) {
      calls.push("settleConnect");
      if (input.insertEmailLink && !links.has(input.slackUserId))
        links.set(input.slackUserId, {
          keycloakSub: input.ownerSub,
          source: "email",
          teamId: input.teamId,
        });
      const link = links.get(input.slackUserId);
      if (!link) throw new Error("no link");
      if (link.keycloakSub !== input.ownerSub)
        return { ok: false, code: "linked-to-another-account", link };
      if (link.teamId !== null && link.teamId !== input.teamId)
        return { ok: false, code: "linked-to-another-workspace", link };

      const existingBinding = bindings.find(
        (b) =>
          b.agentId === input.agentId &&
          b.teamId === input.teamId &&
          b.slackChannelId === input.dmChannelId,
      );
      let created = false;
      if (!existingBinding) {
        created = true;
        const takenBy = bindings.find(
          (b) =>
            b.teamId === input.teamId && b.slackChannelId === input.dmChannelId,
        );
        if (takenBy) takenBy.isDefault = true;
        bindings.push({
          agentId: input.agentId,
          owner: input.ownerSub,
          teamId: input.teamId,
          slackChannelId: input.dmChannelId,
          isDefault: !bindings.some(
            (b) =>
              b.teamId === input.teamId &&
              b.slackChannelId === input.dmChannelId,
          ),
        });
      } else if (
        !bindings.some(
          (b) =>
            b.teamId === input.teamId &&
            b.slackChannelId === input.dmChannelId &&
            b.isDefault,
        )
      ) {
        existingBinding.isDefault = true;
      }
      const isDefault =
        bindings.find(
          (b) =>
            b.agentId === input.agentId &&
            b.teamId === input.teamId &&
            b.slackChannelId === input.dmChannelId,
        )?.isDefault === true;

      const id = key(input.agentId, input.teamId, input.dmChannelId);
      const previous = bridges.get(id);
      const reopened = previous !== undefined && previous.state !== "active";
      bridges.set(id, {
        agentId: input.agentId,
        teamId: input.teamId,
        dmChannelId: input.dmChannelId,
        ownerSub: input.ownerSub,
        slackUserId: input.slackUserId,
        state: "active",
        generation: (previous?.generation ?? 0) + 1,
        helloClaimedAt: reopened ? null : (previous?.helloClaimedAt ?? null),
        helloPostedAt: reopened ? null : (previous?.helloPostedAt ?? null),
      });
      return {
        ok: true,
        link,
        linkCreated: link.source === "email" && !previous,
        binding: { created, isDefault },
        bridge: {
          created: previous === undefined,
          state: "active" as const,
          generation: bridges.get(id)!.generation,
        },
      };
    },

    async find(agentId, teamId, dmChannelId) {
      return bridges.get(key(agentId, teamId, dmChannelId)) ?? null;
    },
    async listForAgent(agentId) {
      return [...bridges.values()].filter((b) => b.agentId === agentId);
    },
    async markRevoking(agentId, teamId, dmChannelId, generation) {
      calls.push("markRevoking");
      if (failAt === "markRevoking") throw new Error("mark failed");
      const record = bridges.get(key(agentId, teamId, dmChannelId));
      if (
        !record ||
        record.generation !== generation ||
        record.state === "revoked"
      )
        return false;
      record.state = "revoking";
      return true;
    },
    async stillRevoking(agentId, teamId, dmChannelId, generation) {
      const record = bridges.get(key(agentId, teamId, dmChannelId));
      return record?.state === "revoking" && record.generation === generation;
    },
    async markRevoked(agentId, teamId, dmChannelId, generation) {
      calls.push("markRevoked");
      if (failAt === "markRevoked") throw new Error("final mark failed");
      const record = bridges.get(key(agentId, teamId, dmChannelId));
      if (
        !record ||
        record.state !== "revoking" ||
        record.generation !== generation
      )
        return false;
      record.state = "revoked";
      return true;
    },
    async claimHello(agentId, teamId, dmChannelId) {
      calls.push("claimHello");
      const record = bridges.get(key(agentId, teamId, dmChannelId));
      if (!record || record.helloPostedAt || record.state !== "active")
        return false;
      if (record.helloClaimedAt) return false;
      record.helloClaimedAt = new Date();
      return true;
    },
    async recordHello(agentId, teamId, dmChannelId) {
      const record = bridges.get(key(agentId, teamId, dmChannelId));
      if (!record) return;
      record.helloPostedAt = new Date();
      record.helloClaimedAt = null;
    },
    async releaseHello(agentId, teamId, dmChannelId) {
      const record = bridges.get(key(agentId, teamId, dmChannelId));
      if (record) record.helloClaimedAt = null;
    },
    async listForConversation(teamId, dmChannelId) {
      return [...bridges.values()].filter(
        (record) =>
          record.teamId === teamId && record.dmChannelId === dmChannelId,
      );
    },
    async reopenChannel(agentId, slackChannelId) {
      for (const record of bridges.values()) {
        if (
          record.agentId === agentId &&
          record.dmChannelId === slackChannelId &&
          record.state !== "active"
        ) {
          record.state = "active";
          record.generation += 1;
          record.helloPostedAt = null;
          record.helloClaimedAt = null;
        }
      }
    },
    async releaseBinding(agentId, teamId, dmChannelId) {
      calls.push("releaseBinding");
      if (failAt === "releaseBinding")
        throw new Error("binding release failed");
      const index = bindings.findIndex(
        (b) =>
          b.agentId === agentId &&
          b.teamId === teamId &&
          b.slackChannelId === dmChannelId,
      );
      if (index >= 0) bindings.splice(index, 1);
    },
    async bindingsInConversation(teamId, dmChannelId) {
      return bindings
        .filter((b) => b.teamId === teamId && b.slackChannelId === dmChannelId)
        .map((b) => ({ agentId: b.agentId, owner: b.owner }));
    },
  };

  return {
    store,
    links,
    bindings,
    bridges,
    calls,
    failNext(step: string) {
      failAt = step;
    },
    recover() {
      failAt = null;
    },
  };
}

interface HarnessOptions {
  trusted?: string[];
  active?: { teamId: string; enterpriseId: string | null }[];
  scopes?: string[] | null;
  verifiedEmail?: string | null;
  users?: SlackEmailUser[];
  links?: ExternalLink[];
  conversation?: SlackConversationLookup;
  emailThrows?: boolean;
  slackConfigured?: boolean;
  threadsFail?: boolean;
  linkDeleteFails?: boolean;
  helloFails?: "refused" | "unknown";
}

function harness(opts: HarnessOptions = {}) {
  const gw = createFakeSlackGateway();
  gw.setEmailUsers(opts.users ?? [emailUser()]);
  gw.setGrantedScopes(
    opts.scopes === undefined ? REQUIRED_SCOPES : opts.scopes,
  );
  const memory = createMemoryStore();
  for (const link of opts.links ?? []) {
    memory.links.set(link.externalUserId, {
      keycloakSub: OWNER,
      source: link.source,
      teamId: link.teamId,
    });
  }
  const hellos: string[] = [];
  const threads: { agentId: string; teamId: string; channelId: string }[] = [];
  const announced: string[] = [];
  const failures = {
    threads: opts.threadsFail ?? false,
    link: opts.linkDeleteFails ?? false,
    hello: (opts.helloFails ?? "sent") as "sent" | "refused" | "unknown",
  };
  const threadsReleased = new Map<string, number>();

  const ports: SlackDmBridgePorts = {
    trustedWorkspaces: opts.trusted ?? [TEAM],
    slackConfigured: opts.slackConfigured ?? true,
    activeWorkspaces: async () =>
      opts.active ?? [{ teamId: TEAM, enterpriseId: ORG }],
    grantedScopes: async (teamId) => {
      const scopes = await gw.getGrantedScopes(teamId);
      return scopes ? [...scopes] : null;
    },
    verifiedEmailOf: async () => {
      if (opts.emailThrows) throw new Error("keycloak down");
      return opts.verifiedEmail === undefined
        ? "owner@example.com"
        : opts.verifiedEmail;
    },
    linksOf: async (sub) =>
      [...memory.links.entries()]
        .filter(([, link]) => link.keycloakSub === sub)
        .map(([externalUserId, link]) => ({
          externalUserId,
          teamId: link.teamId,
          source: link.source,
        })),
    lookupUserByEmail: (email, teamId) => gw.lookupUserByEmail(email, teamId),
    openDirectMessage: async (slackUserId) =>
      gw.openDirectMessage(slackUserId, TEAM),
    conversationInfo: async (channelId) =>
      opts.conversation ?? {
        kind: "found",
        isMember: true,
        isDirectMessage: true,
        isGroupDirectMessage: false,
        name: null,
        directMessageUser: channelId.replace(/^D-/, ""),
      },
    agentOf: async (agentId, sub) =>
      agentId === AGENT && sub === OWNER ? { id: AGENT, name: "Dammy" } : null,
    bridges: memory.store,
    releaseOwnedThreads: async (agentId, teamId, channelId) => {
      threads.push({ agentId, teamId, channelId });
      if (failures.threads) throw new Error("threads release failed");
      threadsReleased.set(`${agentId}|${teamId}|${channelId}`, 1);
      return 1;
    },
    unlinkEmailLink: async (slackUserId, teamId) => {
      if (failures.link) throw new Error("link delete failed");
      const link = memory.links.get(slackUserId);
      if (!link || link.source !== "email" || link.teamId !== teamId) return 0;
      memory.links.delete(slackUserId);
      return 1;
    },
    announceEmailLink: (slackUserId, sub) => {
      announced.push(`${slackUserId}|${sub}`);
    },
    postHello: async (_agentId, _channelId, text) => {
      hellos.push(text);
      return failures.hello;
    },
    brandShort: "dam",
  };

  return {
    gw,
    memory,
    hellos,
    threads,
    announced,
    failures,
    ports,
    service: createSlackDmBridgeService(ports),
    revoker: createSlackDmRevoker({
      bridges: memory.store,
      releaseOwnedThreads: ports.releaseOwnedThreads,
      unlinkEmailLink: ports.unlinkEmailLink,
    }),
  };
}

describe("slack dm bridge status", () => {
  // TEST_SCENARIO: With no trusted workspace, or no Slack app, the feature is off and nothing is looked up.
  it("is off with no trusted workspace or no Slack", async () => {
    const untrusted = harness({ trusted: [] });
    expect(await untrusted.service.status(OWNER)).toEqual({
      state: "off",
      reason: "feature-off",
    });
    expect(untrusted.gw.readEmailLookups()).toEqual([]);

    const unconfigured = harness({ slackConfigured: false });
    expect(await unconfigured.service.status(OWNER)).toEqual({
      state: "off",
      reason: "feature-off",
    });
  });

  // TEST_SCENARIO: A workspace the operator did not list is never searched, even when it is installed, active and grants every scope.
  it("never searches an untrusted workspace", async () => {
    const h = harness({
      trusted: [TEAM],
      active: [
        { teamId: TEAM, enterpriseId: ORG },
        { teamId: OTHER_TEAM, enterpriseId: null },
      ],
      users: [emailUser({ teamId: OTHER_TEAM })],
    });
    const status = await h.service.status(OWNER);
    expect(status.state).toBe("unavailable");
    expect(h.gw.readEmailLookups()).toEqual([`${TEAM}|owner@example.com`]);
  });

  // TEST_SCENARIO: No verified email, an unreachable directory, or no mailbox match all leave nothing to pair.
  it("fails closed without a verified email", async () => {
    for (const verifiedEmail of [null, ""]) {
      const h = harness({ verifiedEmail });
      expect(await h.service.status(OWNER)).toEqual({
        state: "unavailable",
        reason: "email",
      });
      expect(h.gw.readEmailLookups()).toEqual([]);
    }
    const down = harness({ emailThrows: true });
    expect(await down.service.status(OWNER)).toEqual({
      state: "unavailable",
      reason: "email",
    });
  });

  // TEST_SCENARIO: An unknown or partial scope grant is not ready.
  it("is unavailable when the granted scope set is missing or unknown", async () => {
    for (const scopes of [
      null,
      REQUIRED_SCOPES.filter((scope) => scope !== "im:write"),
    ]) {
      const h = harness({ scopes });
      expect(await h.service.status(OWNER)).toEqual({
        state: "unavailable",
        reason: "scopes",
      });
    }
  });

  // TEST_SCENARIO: The fake answers with whatever it was given, so each refusal is the domain's own: a different mailbox, a foreign workspace, a foreign organization, a guest, a stranger, a bot, an app, the deleted.
  it("refuses every account the workspace does not vouch for", async () => {
    const refused: Partial<SlackEmailUser>[] = [
      { email: "someone@example.com" },
      { teamId: OTHER_TEAM },
      { enterpriseId: "E0FOREIGN" },
      { enterpriseId: null },
      { deleted: true },
      { isBot: true },
      { isAppUser: true },
      { isRestricted: true },
      { isUltraRestricted: true },
      { isStranger: true },
      { enterpriseIsGuest: true },
    ];
    for (const overrides of refused) {
      const h = harness({ users: [emailUser(overrides)] });
      expect(await h.service.status(OWNER), JSON.stringify(overrides)).toEqual({
        state: "unavailable",
        reason: "no-match",
      });
    }
  });

  // TEST_SCENARIO: A proven link in a trusted, ready workspace is ready without any lookup, and the destination is the same one on every read.
  it("reports linked for an existing identity and picks it deterministically", async () => {
    const h = harness({
      links: [
        { externalUserId: "U0SECOND", teamId: TEAM, source: "oauth" },
        { externalUserId: "U0OWNER", teamId: TEAM, source: "oauth" },
      ],
    });
    expect(await h.service.status(OWNER)).toEqual({
      state: "linked",
      teamId: TEAM,
      slackUserId: "U0SECOND",
    });
    expect(h.gw.readEmailLookups()).toEqual([]);
  });
});

describe("slack dm bridge connect", () => {
  // TEST_SCENARIO: The happy path settles a link, a binding as the DM's default, and one hello; a second connect reports the same destination, posts nothing and announces nothing.
  it("pairs by email, binds as the DM's default and greets once", async () => {
    const h = harness();
    const first = await h.service.connect(OWNER, {
      agentId: AGENT,
      purpose: "your Friday draft",
    });
    expect(first).toMatchObject({
      ok: true,
      teamId: TEAM,
      slackUserId: "U0OWNER",
      dmChannelId: "D-U0OWNER",
      link: "created",
      binding: "created",
      isDefault: true,
      helloPosted: true,
    });
    expect(h.memory.links.get("U0OWNER")).toMatchObject({
      keycloakSub: OWNER,
      source: "email",
      teamId: TEAM,
    });
    expect(h.memory.bindings).toMatchObject([
      { agentId: AGENT, teamId: TEAM, isDefault: true },
    ]);
    expect(h.hellos).toHaveLength(1);
    expect(h.hellos[0]).toContain("Hi, I'm Dammy from dam.");
    expect(h.hellos[0]).toContain("I'll send you your Friday draft here");
    expect(h.hellos[0]).toContain(
      "You can ask me about your results here. To change what I do, ask me in dam.",
    );
    expect(h.hellos[0]).toContain("Type `/dam unbind` here.");
    expect(h.announced).toEqual([`U0OWNER|${OWNER}`]);

    const second = await h.service.connect(OWNER, { agentId: AGENT });
    expect(second).toMatchObject({
      ok: true,
      link: "existing",
      binding: "existing",
      helloPosted: false,
    });
    expect(h.hellos).toHaveLength(1);
    expect(h.announced).toHaveLength(1);
  });

  // TEST_SCENARIO: Two connects racing each other greet once, because the record claims the greeting atomically.
  it("greets once when two connects race", async () => {
    const h = harness();
    const [a, b] = await Promise.all([
      h.service.connect(OWNER, { agentId: AGENT }),
      h.service.connect(OWNER, { agentId: AGENT }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(h.hellos).toHaveLength(1);
    expect(h.memory.bridges.size).toBe(1);
  });

  // TEST_SCENARIO: A DM that already has a default keeps it, and the hello says how to reach this agent and which unbind resolves it.
  it("keeps an existing default and names the agent in the unbind hint", async () => {
    const h = harness();
    h.memory.bindings.push({
      agentId: "agent-other",
      owner: OWNER,
      teamId: TEAM,
      slackChannelId: "D-U0OWNER",
      isDefault: true,
    });
    const result = await h.service.connect(OWNER, { agentId: AGENT });
    expect(result).toMatchObject({ ok: true, isDefault: false });
    expect(h.hellos[0]).toContain("Start a message with Dammy to reach me.");
    expect(h.hellos[0]).toContain("Type `/dam unbind Dammy` here.");
  });

  // TEST_SCENARIO: A Slack account linked to another person, or linked in another workspace, is refused and reported with the link that stayed.
  it("refuses a link it must not overwrite, and reports what stayed", async () => {
    const h = harness();
    h.memory.links.set("U0OWNER", {
      keycloakSub: OTHER_OWNER,
      source: "oauth",
      teamId: TEAM,
    });
    const other = await h.service.connect(OWNER, { agentId: AGENT });
    expect(other).toMatchObject({
      ok: false,
      code: "linked-to-another-account",
      partial: { dmChannelId: "D-U0OWNER", link: "existing" },
    });
    expect(h.memory.links.get("U0OWNER")?.keycloakSub).toBe(OTHER_OWNER);
    expect(h.memory.bindings).toEqual([]);
    expect(h.announced).toEqual([]);

    const elsewhere = harness();
    elsewhere.memory.links.set("U0OWNER", {
      keycloakSub: OWNER,
      source: "oauth",
      teamId: OTHER_TEAM,
    });
    expect(
      await elsewhere.service.connect(OWNER, { agentId: AGENT }),
    ).toMatchObject({ ok: false, code: "linked-to-another-workspace" });
    expect(elsewhere.memory.bindings).toEqual([]);
  });

  // TEST_SCENARIO: A conversation that is a group DM, or a DM with somebody else, is refused before anything is written.
  it("refuses a group DM or a DM with someone else", async () => {
    const group = harness({
      conversation: {
        kind: "found",
        isMember: true,
        isDirectMessage: true,
        isGroupDirectMessage: true,
        name: null,
        directMessageUser: "U0OWNER",
      },
    });
    expect((await group.service.connect(OWNER, { agentId: AGENT })).ok).toBe(
      false,
    );
    expect(group.memory.links.size).toBe(0);
    expect(group.memory.bindings).toEqual([]);
    expect(group.hellos).toEqual([]);

    const someoneElse = harness({
      conversation: {
        kind: "found",
        isMember: true,
        isDirectMessage: true,
        isGroupDirectMessage: false,
        name: null,
        directMessageUser: "U0STRANGER",
      },
    });
    expect(
      (await someoneElse.service.connect(OWNER, { agentId: AGENT })).ok,
    ).toBe(false);
    expect(someoneElse.memory.bindings).toEqual([]);
  });

  // TEST_SCENARIO: An Agent the caller does not own cannot be bound, and it is refused before Slack is asked anything.
  it("refuses an agent the caller does not own", async () => {
    const h = harness();
    expect(
      await h.service.connect(OWNER, { agentId: "agent-other" }),
    ).toMatchObject({ ok: false, code: "agent-not-found" });
    expect(h.gw.readEmailLookups()).toEqual([]);
    expect(h.memory.calls).toEqual([]);
  });
});

describe("the greeting", () => {
  // TEST_SCENARIO: Slack refusing the greeting gives the claim back, so the next connect posts it and says so.
  it("retries a greeting Slack refused", async () => {
    const h = harness({ helloFails: "refused" });
    const first = await h.service.connect(OWNER, { agentId: AGENT });
    expect(first).toMatchObject({ ok: true, helloPosted: false });
    h.failures.hello = "sent";
    const second = await h.service.connect(OWNER, { agentId: AGENT });
    expect(second).toMatchObject({
      ok: true,
      binding: "existing",
      helloPosted: true,
    });
    expect(h.hellos).toHaveLength(2);
  });

  // TEST_SCENARIO: a greeting nobody saw the answer to keeps its claim, so the next connect does not post a second one.
  it("keeps the claim of a greeting whose answer nobody saw", async () => {
    const h = harness({ helloFails: "unknown" });
    await h.service.connect(OWNER, { agentId: AGENT });
    h.failures.hello = "sent";
    const second = await h.service.connect(OWNER, { agentId: AGENT });
    expect(second).toMatchObject({ ok: true, helloPosted: false });
    expect(h.hellos).toHaveLength(1);
    expect(
      h.memory.bridges.get(`${AGENT}|${TEAM}|D-U0OWNER`)?.helloClaimedAt,
    ).toBeTruthy();
  });

  // TEST_SCENARIO: an exception after the settlement reports what exists instead of losing it.
  it("reports the settled state when a later step throws", async () => {
    const h = harness();
    h.memory.store.bindingsInConversation = async () => {
      throw new Error("database glitch");
    };
    const result = await h.service.connect(OWNER, { agentId: AGENT });
    expect(result).toMatchObject({
      ok: true,
      binding: "created",
      link: "created",
      helloPosted: false,
    });
  });
});

describe("a connect racing a revoke", () => {
  // TEST_SCENARIO: a revoke that started before a reconnect stops: the new generation owns the DM, and its binding and greeting survive.
  it("stops a stale revoke at the generation boundary", async () => {
    const h = harness();
    await h.service.connect(OWNER, { agentId: AGENT });
    const record = h.memory.bridges.get(`${AGENT}|${TEAM}|D-U0OWNER`)!;
    const stale = { ...record };
    // TEST_SCENARIO: the person reconnects between the mark and the cleanup.
    await h.service.connect(OWNER, { agentId: AGENT });
    const released = await h.revoker.revoke(stale);
    expect(released.ok).toBe(false);
    expect(released.marked).toBe(false);
    expect(h.memory.bindings).toHaveLength(1);
    expect(h.memory.bridges.get(`${AGENT}|${TEAM}|D-U0OWNER`)?.state).toBe(
      "active",
    );
  });
});

describe("slack dm bridge disconnect", () => {
  // TEST_SCENARIO: A revoke removes the binding, the threads that Agent's Sessions owned there and the email link, and records it as revoked.
  it("releases the binding, its threads and the email link", async () => {
    const h = harness();
    await h.service.connect(OWNER, { agentId: AGENT });
    const result = await h.service.disconnect(OWNER, { agentId: AGENT });
    expect(result).toMatchObject({
      ok: true,
      disconnected: 1,
      threadsReleased: 1,
      linksRemoved: 1,
      incomplete: [],
    });
    expect(h.memory.bindings).toEqual([]);
    expect(h.memory.links.has("U0OWNER")).toBe(false);
    expect(h.memory.bridges.get(`${AGENT}|${TEAM}|D-U0OWNER`)?.state).toBe(
      "revoked",
    );
  });

  // TEST_SCENARIO: A link a Keycloak sign-in proved stays, and so does another Agent bound in the same DM.
  it("keeps an oauth link and another agent's binding", async () => {
    const h = harness({
      links: [{ externalUserId: "U0OWNER", teamId: TEAM, source: "oauth" }],
    });
    await h.service.connect(OWNER, { agentId: AGENT });
    h.memory.bindings.push({
      agentId: "agent-other",
      owner: OWNER,
      teamId: TEAM,
      slackChannelId: "D-U0OWNER",
      isDefault: false,
    });
    const result = await h.service.disconnect(OWNER, { agentId: AGENT });
    expect(result).toMatchObject({
      ok: true,
      disconnected: 1,
      linksRemoved: 0,
    });
    expect(h.memory.links.get("U0OWNER")?.source).toBe("oauth");
    expect(h.memory.bindings.map((b) => b.agentId)).toEqual(["agent-other"]);
  });

  // TEST_SCENARIO: A revoke needs no live link: after a logout removed it, the record still releases the binding and threads.
  it("finishes a revoke after the link is gone", async () => {
    const h = harness();
    await h.service.connect(OWNER, { agentId: AGENT });
    h.memory.links.clear();
    const result = await h.service.disconnect(OWNER, { agentId: AGENT });
    expect(result).toMatchObject({
      ok: true,
      disconnected: 1,
      linksRemoved: 0,
    });
    expect(h.memory.bindings).toEqual([]);
  });

  // TEST_SCENARIO: A failure at each cleanup step — the binding, the threads, the link, the final state — leaves the record revoking, reports the revoke as incomplete, and a retry finishes it without asking Slack anything.
  it("reports an unfinished revoke and finishes it on retry", async () => {
    const steps = ["releaseBinding", "threads", "link", "markRevoked"];
    for (const step of steps) {
      const h = harness();
      await h.service.connect(OWNER, { agentId: AGENT });
      if (step === "threads") h.failures.threads = true;
      else if (step === "link") h.failures.link = true;
      else h.memory.failNext(step);
      const failed = await h.service.disconnect(OWNER, { agentId: AGENT });
      expect(failed, step).toMatchObject({
        ok: true,
        disconnected: 0,
        incomplete: ["D-U0OWNER"],
      });
      expect(
        h.memory.bridges.get(`${AGENT}|${TEAM}|D-U0OWNER`)?.state,
        step,
      ).toBe("revoking");
      expect(h.gw.readEmailLookups()).toEqual([`${TEAM}|owner@example.com`]);

      h.memory.recover();
      h.failures.threads = false;
      h.failures.link = false;
      const retried = await h.service.disconnect(OWNER, { agentId: AGENT });
      expect(retried, step).toMatchObject({
        ok: true,
        disconnected: 1,
        incomplete: [],
      });
      expect(h.memory.bindings, step).toEqual([]);
      expect(h.memory.links.has("U0OWNER"), step).toBe(false);
    }
  });

  // TEST_SCENARIO: A Slack outage during the revoke changes nothing, because nothing in it asks Slack.
  it("revokes without asking Slack", async () => {
    const h = harness();
    await h.service.connect(OWNER, { agentId: AGENT });
    const before = h.gw.readEmailLookups().length;
    const result = await h.service.disconnect(OWNER, { agentId: AGENT });
    expect(result).toMatchObject({ ok: true, disconnected: 1 });
    expect(h.gw.readEmailLookups()).toHaveLength(before);
  });

  // TEST_SCENARIO: Two workspaces can share a conversation id; only the one the record names is released.
  it("releases only the workspace the record names", async () => {
    const h = harness({ trusted: [TEAM, OTHER_TEAM] });
    await h.service.connect(OWNER, { agentId: AGENT });
    h.memory.bridges.set(`${AGENT}|${OTHER_TEAM}|D-U0OWNER`, {
      agentId: AGENT,
      teamId: OTHER_TEAM,
      dmChannelId: "D-U0OWNER",
      ownerSub: OTHER_OWNER,
      slackUserId: "U0SOMEONEELSE",
      state: "active",
      generation: 1,
      helloClaimedAt: null,
      helloPostedAt: new Date(),
    });
    h.memory.bindings.push({
      agentId: AGENT,
      owner: OTHER_OWNER,
      teamId: OTHER_TEAM,
      slackChannelId: "D-U0OWNER",
      isDefault: true,
    });
    await h.service.disconnect(OWNER, { agentId: AGENT });
    expect(
      h.memory.bindings.map((b) => b.teamId),
      "the other workspace's binding stays",
    ).toEqual([OTHER_TEAM]);
  });

  // TEST_SCENARIO: An owner paired twice in one workspace keeps the identity the released DM did not use.
  it("keeps a second email identity of the same owner", async () => {
    const h = harness({
      users: [emailUser()],
    });
    await h.service.connect(OWNER, { agentId: AGENT });
    h.memory.links.set("U0SECOND", {
      keycloakSub: OWNER,
      source: "email",
      teamId: TEAM,
    });
    await h.service.disconnect(OWNER, { agentId: AGENT });
    expect(h.memory.links.has("U0OWNER")).toBe(false);
    expect(h.memory.links.get("U0SECOND")?.keycloakSub).toBe(OWNER);
  });

  // TEST_SCENARIO: An Agent with no Bridge record of the caller's is left alone.
  it("does nothing for an agent with no bridge record", async () => {
    const h = harness();
    expect(await h.service.disconnect(OWNER, { agentId: AGENT })).toMatchObject(
      { ok: true, disconnected: 0, incomplete: [] },
    );
    expect(h.memory.calls).toEqual([]);
  });
});

describe("the in-chat unbind", () => {
  // TEST_SCENARIO: The release acts only on a DM the Bridge recorded for that Agent, and reports a revoke it could not finish.
  it("releases only a recorded DM and reports an unfinished revoke", async () => {
    const h = harness();
    await h.service.connect(OWNER, { agentId: AGENT });
    expect(
      await h.revoker.releaseInChat({
        agentId: AGENT,
        teamId: TEAM,
        slackChannelId: "C0CHANNEL",
      }),
    ).toBe("none");
    expect(h.memory.calls.filter((c) => c.startsWith("setState"))).toEqual([]);

    h.memory.failNext("releaseBinding");
    expect(
      await h.revoker.releaseInChat({
        agentId: AGENT,
        teamId: TEAM,
        slackChannelId: "D-U0OWNER",
      }),
    ).toBe("incomplete");

    h.memory.recover();
    expect(
      await h.revoker.releaseInChat({
        agentId: AGENT,
        teamId: TEAM,
        slackChannelId: "D-U0OWNER",
      }),
    ).toBe("revoked");
    expect(h.memory.bindings).toEqual([]);
  });
});
