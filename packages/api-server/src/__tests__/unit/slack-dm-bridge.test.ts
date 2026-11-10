// TEST_OVERVIEW: The Slack DM Bridge pairs an owner's verified email with their Slack account only inside operator-trusted workspaces, and every doubt is a refusal: an unverified or unreachable mailbox, an unknown scope grant, a guest, stranger, bot or deleted account, a mailbox match on a re-assigned address, a Slack account linked to another person, or a conversation that is not the 1:1 with that person. A connect writes an email link that never moves the link, binds the Agent as the DM's default only while it has none, and posts the hello once; a disconnect and an in-chat unbind release the binding, the threads it owned and only an email link.
import { describe, expect, it } from "vitest";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type {
  SlackConversationLookup,
  SlackEmailUser,
} from "../../modules/channels/infrastructure/slack-gateway.js";
import type { ExternalLink } from "../../modules/channels/services/identity-link-service.js";
import {
  createSlackDmBridgeRelease,
  createSlackDmBridgeService,
  type SlackDmBridgePorts,
} from "../../modules/channels/services/slack-dm-bridge-service.js";
import {
  insertEmailIdentityLinkIfAbsent,
  upsertIdentityLink,
} from "../../modules/channels/infrastructure/identity-links-repository.js";

const OWNER = "kc|owner";
const OTHER = "kc|other";
const AGENT = "agent-1";
const TRUSTED = "T-TRUSTED";
const OTHER_WORKSPACE = "T-OTHER";
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
    id: "U-OWNER",
    teamId: TRUSTED,
    enterpriseId: null,
    email: "owner@example.com",
    deleted: false,
    isBot: false,
    isAppUser: false,
    isRestricted: false,
    isUltraRestricted: false,
    isStranger: false,
    ...overrides,
  };
}

interface HarnessOptions {
  trusted?: string[];
  active?: string[];
  scopes?: string[] | null;
  verifiedEmail?: string | null;
  users?: SlackEmailUser[];
  links?: ExternalLink[];
  conversation?: SlackConversationLookup;
  emailThrows?: boolean;
  slackConfigured?: boolean;
}

function harness(opts: HarnessOptions = {}) {
  const gw = createFakeSlackGateway();
  gw.setEmailUsers(opts.users ?? [emailUser()]);
  gw.setGrantedScopes(
    opts.scopes === undefined ? REQUIRED_SCOPES : opts.scopes,
  );

  const links = new Map<
    string,
    { keycloakSub: string; source: "oauth" | "email"; teamId: string | null }
  >();
  for (const link of opts.links ?? []) {
    links.set(link.externalUserId, {
      keycloakSub: OWNER,
      source: link.source,
      teamId: link.teamId,
    });
  }
  const bindings: {
    agentId: string;
    slackChannelId: string;
    teamId: string;
    isDefault: boolean;
  }[] = [];
  const hellos: string[] = [];
  const released: { agentId: string; channelId: string }[] = [];

  const ports: SlackDmBridgePorts = {
    trustedWorkspaces: opts.trusted ?? [TRUSTED],
    slackConfigured: opts.slackConfigured ?? true,
    activeWorkspaces: async () => opts.active ?? [TRUSTED],
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
      [...links.entries()]
        .filter(([, link]) => link.keycloakSub === sub)
        .map(([externalUserId, link]) => ({
          externalUserId,
          teamId: link.teamId,
          source: link.source,
        })),
    linkOfExternalUser: async (externalUserId) => {
      const link = links.get(externalUserId);
      return link
        ? { keycloakSub: link.keycloakSub, source: link.source }
        : null;
    },
    linkByEmail: async (externalUserId, keycloakSub, teamId) => {
      if (!links.has(externalUserId))
        links.set(externalUserId, {
          keycloakSub,
          source: "email",
          teamId,
        });
    },
    unlinkEmailOf: async (keycloakSub: string, teamId: string) => {
      let removed = 0;
      for (const [id, link] of links)
        if (
          link.keycloakSub === keycloakSub &&
          link.source === "email" &&
          link.teamId === teamId
        ) {
          links.delete(id);
          removed += 1;
        }
      return removed;
    },
    lookupUserByEmail: (email, teamId) => gw.lookupUserByEmail(email, teamId),
    openDirectMessage: async (slackUserId, teamId) =>
      gw.openDirectMessage(slackUserId, teamId),
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
    bindingsOf: async (agentId) =>
      bindings
        .filter((binding) => binding.agentId === agentId)
        .map(({ slackChannelId, teamId, isDefault }) => ({
          slackChannelId,
          teamId,
          isDefault,
        })),
    bindingsInConversation: async (slackChannelId) =>
      bindings
        .filter((binding) => binding.slackChannelId === slackChannelId)
        .map(({ agentId, teamId }) => ({ agentId, owner: teamId })),
    bindAgent: async (agentId, slackChannelId) => {
      const isDefault = !bindings.some(
        (binding) => binding.slackChannelId === slackChannelId,
      );
      bindings.push({
        agentId,
        slackChannelId,
        teamId: TRUSTED,
        isDefault,
      });
      return { ok: true, isDefault };
    },
    unbindAgent: async (agentId, slackChannelId) => {
      const index = bindings.findIndex(
        (binding) =>
          binding.agentId === agentId &&
          binding.slackChannelId === slackChannelId,
      );
      if (index >= 0) bindings.splice(index, 1);
    },
    releaseOwnedThreads: async (agentId, channelId) => {
      released.push({ agentId, channelId });
      return 1;
    },
    postHello: async (_agentId, _channelId, text) => {
      hellos.push(text);
      return true;
    },
    brandShort: "dam",
  };

  return {
    gw,
    links,
    bindings,
    hellos,
    released,
    service: createSlackDmBridgeService(ports),
    ports,
  };
}

describe("slack dm bridge status", () => {
  // TEST_SCENARIO: With no trusted workspace the feature is off, and nothing is looked up in Slack.
  it("is off with no trusted workspace and sends nothing", async () => {
    const h = harness({ trusted: [] });
    expect(await h.service.status(OWNER)).toEqual({
      state: "off",
      reason: "feature-off",
    });
    expect(h.gw.readEmailLookups()).toEqual([]);

    const unconfigured = harness({ slackConfigured: false });
    expect(await unconfigured.service.status(OWNER)).toEqual({
      state: "off",
      reason: "feature-off",
    });
  });

  // TEST_SCENARIO: A workspace the operator did not list is never searched, even when it is installed, active and grants every scope.
  it("never searches an untrusted workspace", async () => {
    const h = harness({
      trusted: [TRUSTED],
      active: [TRUSTED, OTHER_WORKSPACE],
      users: [emailUser({ teamId: OTHER_WORKSPACE })],
    });
    const status = await h.service.status(OWNER);
    expect(status.state).toBe("unavailable");
    expect(h.gw.readEmailLookups()).toEqual([`${TRUSTED}|owner@example.com`]);
    expect(
      h.gw
        .readEmailLookups()
        .filter((lookup) => lookup.startsWith(OTHER_WORKSPACE)),
    ).toEqual([]);
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

  // TEST_SCENARIO: An unknown or partial scope grant is not ready — hasScope's "unknown means granted" must not decide this.
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

  // TEST_SCENARIO: Every account the workspace does not vouch for by membership is refused, and so is a mailbox that is not the verified one.
  it("refuses guests, strangers, bots, the deleted and a different mailbox", async () => {
    const refused: Partial<SlackEmailUser>[] = [
      { isRestricted: true },
      { isUltraRestricted: true },
      { isStranger: true },
      { deleted: true },
      { isBot: true },
      { isAppUser: true },
      { email: "someone@example.com" },
      { teamId: OTHER_WORKSPACE },
    ];
    for (const overrides of refused) {
      const h = harness({ users: [emailUser(overrides)] });
      const status = await h.service.status(OWNER);
      expect(status, JSON.stringify(overrides)).toEqual({
        state: "unavailable",
        reason: "no-match",
      });
      expect(h.bindings).toEqual([]);
    }
  });

  // TEST_SCENARIO: A proven link in a trusted, ready workspace is ready without any lookup.
  it("reports linked for an existing identity in a trusted workspace", async () => {
    const h = harness({
      links: [{ externalUserId: "U-OWNER", teamId: TRUSTED, source: "oauth" }],
    });
    expect(await h.service.status(OWNER)).toEqual({
      state: "linked",
      teamId: TRUSTED,
      slackUserId: "U-OWNER",
    });
    expect(h.gw.readEmailLookups()).toEqual([]);
  });
});

describe("slack dm bridge connect", () => {
  // TEST_SCENARIO: The happy path writes an email link, binds the Agent as the DM's default, and says hello once; a second connect reports the binding and posts nothing.
  it("pairs by email, binds the DM as its default and posts the hello once", async () => {
    const h = harness();
    const first = await h.service.connect(OWNER, {
      agentId: AGENT,
      purpose: "your Friday draft",
    });
    expect(first).toMatchObject({
      ok: true,
      teamId: TRUSTED,
      slackUserId: "U-OWNER",
      dmChannelId: "D-U-OWNER",
      binding: "created",
      isDefault: true,
      helloPosted: true,
    });
    expect(h.links.get("U-OWNER")).toMatchObject({
      keycloakSub: OWNER,
      source: "email",
      teamId: TRUSTED,
    });
    expect(h.bindings).toMatchObject([
      { agentId: AGENT, slackChannelId: "D-U-OWNER", isDefault: true },
    ]);
    expect(h.hellos).toHaveLength(1);
    expect(h.hellos[0]).toContain("Hi, I'm Dammy from dam.");
    expect(h.hellos[0]).toContain("I'll send you your Friday draft here");
    expect(h.hellos[0]).toContain("act on your dam account");
    expect(h.hellos[0]).toContain("/dam unbind");
    expect(h.hellos[0]).not.toContain("Start a message with");

    const second = await h.service.connect(OWNER, { agentId: AGENT });
    expect(second).toMatchObject({ ok: true, binding: "existing" });
    expect(h.hellos).toHaveLength(1);
    expect(h.bindings).toHaveLength(1);
  });

  // TEST_SCENARIO: A DM that already has a default keeps it; the new Agent is bound beside it and the hello says how to reach it.
  it("keeps an existing default and tells the owner how to reach the agent", async () => {
    const h = harness();
    h.bindings.push({
      agentId: "agent-other",
      slackChannelId: "D-U-OWNER",
      teamId: TRUSTED,
      isDefault: true,
    });
    const result = await h.service.connect(OWNER, { agentId: AGENT });
    expect(result).toMatchObject({ ok: true, isDefault: false });
    expect(h.bindings.find((b) => b.agentId === "agent-other")?.isDefault).toBe(
      true,
    );
    expect(h.hellos[0]).toContain("Start a message with Dammy to reach me.");
  });

  // TEST_SCENARIO: A Slack account already linked to someone else is refused and its link is left exactly as it was.
  it("refuses a Slack account linked to another account", async () => {
    const h = harness();
    h.links.set("U-OWNER", {
      keycloakSub: OTHER,
      source: "oauth",
      teamId: TRUSTED,
    });
    const result = await h.service.connect(OWNER, { agentId: AGENT });
    expect(result.ok).toBe(false);
    expect(h.links.get("U-OWNER")?.keycloakSub).toBe(OTHER);
    expect(h.bindings).toEqual([]);
  });

  // TEST_SCENARIO: A conversation that is a group DM, or a DM with somebody else, is refused before anything is linked or bound.
  it("refuses a group DM or a DM with someone else", async () => {
    const group = harness({
      conversation: {
        kind: "found",
        isMember: true,
        isDirectMessage: true,
        isGroupDirectMessage: true,
        name: null,
        directMessageUser: "U-OWNER",
      },
    });
    expect((await group.service.connect(OWNER, { agentId: AGENT })).ok).toBe(
      false,
    );
    expect(group.links.size).toBe(0);
    expect(group.bindings).toEqual([]);
    expect(group.hellos).toEqual([]);

    const someoneElse = harness({
      conversation: {
        kind: "found",
        isMember: true,
        isDirectMessage: true,
        isGroupDirectMessage: false,
        name: null,
        directMessageUser: "U-STRANGER",
      },
    });
    expect(
      (await someoneElse.service.connect(OWNER, { agentId: AGENT })).ok,
    ).toBe(false);
    expect(someoneElse.links.size).toBe(0);
    expect(someoneElse.bindings).toEqual([]);
  });

  // TEST_SCENARIO: An Agent the caller does not own cannot be bound, and a refused agent is refused before Slack is asked anything.
  it("refuses an agent the caller does not own", async () => {
    const h = harness();
    const result = await h.service.connect(OWNER, { agentId: "agent-other" });
    expect(result).toMatchObject({ ok: false, code: "agent-not-found" });
    expect(h.gw.readEmailLookups()).toEqual([]);
    expect(h.bindings).toEqual([]);
  });
});

describe("slack dm bridge disconnect", () => {
  // TEST_SCENARIO: Disconnecting removes the binding, releases the threads it owned and drops the email link once nothing is bound in that DM.
  it("releases the binding, its threads and the email link", async () => {
    const h = harness();
    await h.service.connect(OWNER, { agentId: AGENT });
    const result = await h.service.disconnect(OWNER, { agentId: AGENT });
    expect(result).toMatchObject({
      ok: true,
      disconnected: 1,
      threadsReleased: 1,
      linksRemoved: 1,
    });
    expect(h.bindings).toEqual([]);
    expect(h.links.has("U-OWNER")).toBe(false);
  });

  // TEST_SCENARIO: A link proven by an OAuth sign-in stays, and so does another Agent bound in the same DM.
  it("keeps an oauth link and another agent's binding", async () => {
    const h = harness({
      links: [{ externalUserId: "U-OWNER", teamId: TRUSTED, source: "oauth" }],
    });
    await h.service.connect(OWNER, { agentId: AGENT });
    h.bindings.push({
      agentId: "agent-other",
      slackChannelId: "D-U-OWNER",
      teamId: TRUSTED,
      isDefault: false,
    });
    const result = await h.service.disconnect(OWNER, { agentId: AGENT });
    expect(result).toMatchObject({
      ok: true,
      disconnected: 1,
      linksRemoved: 0,
    });
    expect(h.links.get("U-OWNER")?.source).toBe("oauth");
    expect(h.bindings.map((b) => b.agentId)).toEqual(["agent-other"]);
  });

  // TEST_SCENARIO: An in-chat unbind in the DM does the same release; in a channel it touches nothing, and it never drops a link while another Agent is still bound.
  it("releases the same state after an in-chat unbind", async () => {
    const h = harness();
    await h.service.connect(OWNER, { agentId: AGENT });
    const unbind = createSlackDmBridgeRelease({
      releaseOwnedThreads: h.ports.releaseOwnedThreads,
      bindingsInConversation: h.ports.bindingsInConversation,
      unlinkEmailOf: h.ports.unlinkEmailOf,
    });
    await h.ports.unbindAgent(AGENT, "D-U-OWNER");
    await unbind({
      agentId: AGENT,
      slackChannelId: "D-U-OWNER",
      teamId: TRUSTED,
      ownerSub: OWNER,
    });
    expect(h.released).toMatchObject([
      { agentId: AGENT, channelId: "D-U-OWNER" },
    ]);
    expect(h.links.has("U-OWNER")).toBe(false);

    const channel = harness();
    await channel.service.connect(OWNER, { agentId: AGENT });
    await unbind({
      agentId: AGENT,
      slackChannelId: "C-GENERAL",
      teamId: TRUSTED,
      ownerSub: OWNER,
    });
    expect(channel.released).toEqual([]);
    expect(channel.links.has("U-OWNER")).toBe(true);
  });
});

describe("identity link source", () => {
  // TEST_SCENARIO: An OAuth sign-in promotes an email link to a proven one, so a later disconnect cannot drop it.
  it("promotes an email link to oauth on sign-in", async () => {
    const writes: { values?: unknown; set?: unknown } = {};
    const db = {
      insert: () => ({
        values: (values: unknown) => {
          writes.values = values;
          return {
            onConflictDoUpdate: async ({ set }: { set: unknown }) => {
              writes.set = set;
            },
            onConflictDoNothing: async () => {},
          };
        },
      }),
    } as unknown as Parameters<typeof upsertIdentityLink>[0];
    await upsertIdentityLink(db)("slack", "U1", OWNER, TRUSTED);
    expect(writes.values).toMatchObject({ source: "oauth" });
    expect(writes.set).toMatchObject({ source: "oauth", keycloakSub: OWNER });
  });

  // TEST_SCENARIO: The pairing's own write inserts and never rewrites an existing row.
  it("inserts an email link only when none exists", async () => {
    let inserted: unknown;
    let conflicted: unknown = "no";
    const db = {
      insert: () => ({
        values: (values: unknown) => {
          inserted = values;
          return {
            onConflictDoNothing: async (args: unknown) => {
              conflicted = args;
            },
          };
        },
      }),
    } as unknown as Parameters<typeof insertEmailIdentityLinkIfAbsent>[0];
    await insertEmailIdentityLinkIfAbsent(db)("slack", "U1", OWNER, TRUSTED);
    expect(inserted).toMatchObject({ source: "email", keycloakSub: OWNER });
    expect(conflicted).toMatchObject({ target: expect.any(Array) });
  });
});
