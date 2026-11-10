// TEST_OVERVIEW: Finding a Slack person by mailbox is where the DM Bridge's trust starts, so the adapter refuses to answer unless Slack said everything it needs: an authoritative workspace (never the one we asked about), a U or W user id, real booleans for every membership marker, a mailbox, and the organization fields when they are present. The domain then refuses a mailbox that is not the verified one, a person the workspace or the organization does not own, a guest, a stranger or an account Slack calls deleted, a bot or an app.
import { describe, expect, it } from "vitest";
import { parseEmailLookup } from "../../modules/channels/infrastructure/bolt-slack-gateway.js";
import {
  acceptEmailMatch,
  acceptDirectMessage,
  missingRequiredScopes,
  slackDmHello,
} from "../../modules/channels/domain/slack-dm-bridge.js";
import type { SlackEmailUser } from "../../modules/channels/infrastructure/slack-gateway.js";

const WORKSPACE = { teamId: "T0TEAM", enterpriseId: "E0ORG" } as const;

/** TEST_SCENARIO: the shape Slack's users.lookupByEmail answers with. */
function rawUser(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    user: {
      id: "U0OWNER",
      team_id: "T0TEAM",
      deleted: false,
      is_bot: false,
      is_app_user: false,
      is_restricted: false,
      is_ultra_restricted: false,
      profile: { email: "owner@example.com" },
      ...overrides,
    },
  };
}

function parsed(overrides: Record<string, unknown> = {}): SlackEmailUser {
  const user = parseEmailLookup(rawUser(overrides));
  if (!user) throw new Error("expected a usable answer");
  return user;
}

describe("the Slack mailbox answer", () => {
  // TEST_SCENARIO: a complete answer becomes the facts the pairing needs, including nothing it has to guess.
  it("keeps every fact Slack actually reported", () => {
    const user = parsed({
      enterprise_user: {
        enterprise_id: "E0ORG",
        is_guest: false,
        teams: ["T0TEAM", "T0OTHER"],
      },
      is_stranger: false,
    });
    expect(user).toEqual({
      id: "U0OWNER",
      teamId: "T0TEAM",
      enterpriseId: "E0ORG",
      enterpriseTeams: ["T0TEAM", "T0OTHER"],
      enterpriseIsGuest: false,
      email: "owner@example.com",
      deleted: false,
      isBot: false,
      isAppUser: false,
      isRestricted: false,
      isUltraRestricted: false,
      isStranger: false,
    });
  });

  // TEST_SCENARIO: an Enterprise Grid person's id starts with W, which is a person like any other.
  it("accepts a W-prefixed Grid user id", () => {
    expect(parsed({ id: "W0OWNER" }).id).toBe("W0OWNER");
  });

  // TEST_SCENARIO: with no workspace of its own the answer cannot say who the person belongs to, so it is unknown, never the workspace we asked about.
  it("refuses an answer with no authoritative workspace", () => {
    expect(parseEmailLookup(rawUser({ team_id: undefined }))).toBeNull();
    expect(parseEmailLookup(rawUser({ team_id: "W0ORG" }))).toBeNull();
  });

  // TEST_SCENARIO: a membership marker that is missing or not a boolean is unknown, and unknown refuses.
  it("refuses a missing or malformed membership marker", () => {
    for (const marker of [
      "deleted",
      "is_bot",
      "is_app_user",
      "is_restricted",
      "is_ultra_restricted",
    ]) {
      expect(parseEmailLookup(rawUser({ [marker]: undefined }))).toBeNull();
      expect(parseEmailLookup(rawUser({ [marker]: "false" }))).toBeNull();
      expect(parseEmailLookup(rawUser({ [marker]: 0 }))).toBeNull();
    }
    expect(parseEmailLookup(rawUser({ is_stranger: "no" }))).toBeNull();
    expect(parseEmailLookup(rawUser({ profile: {} }))).toBeNull();
    expect(parseEmailLookup(rawUser({ profile: { email: "" } }))).toBeNull();
    expect(parseEmailLookup(rawUser({ id: "owner" }))).toBeNull();
    expect(parseEmailLookup({ ok: false })).toBeNull();
  });

  // TEST_SCENARIO: an absent stranger marker stays unknown rather than becoming false, and the domain reads it as no evidence either way.
  it("keeps an unreported stranger marker unknown", () => {
    expect(parsed().isStranger).toBeNull();
    expect(
      acceptEmailMatch(parsed(), "owner@example.com", {
        teamId: "T0TEAM",
        enterpriseId: null,
      }),
    ).toBeNull();
  });

  // TEST_SCENARIO: enterprise fields are carried and validated, so a malformed organization is unknown too.
  it("carries or refuses the organization fields", () => {
    expect(parsed({ enterprise_id: "E0ORG" }).enterpriseId).toBe("E0ORG");
    expect(parseEmailLookup(rawUser({ enterprise_id: "org" }))).toBeNull();
    expect(
      parseEmailLookup(rawUser({ enterprise_user: { enterprise_id: "nope" } })),
    ).toBeNull();
    expect(
      parseEmailLookup(rawUser({ enterprise_user: { teams: ["nope"] } })),
    ).toBeNull();
  });
});

describe("the mailbox match", () => {
  // TEST_SCENARIO: the happy path — same mailbox, same workspace, same organization, an ordinary member.
  it("accepts the verified mailbox of an ordinary member of the workspace", () => {
    expect(
      acceptEmailMatch(
        parsed({ enterprise_user: { enterprise_id: "E0ORG" } }),
        "Owner@Example.com",
        WORKSPACE,
      ),
    ).toBeNull();
  });

  // TEST_SCENARIO: a mailbox that is not the verified one is refused, whatever else the person is.
  it("refuses a different mailbox", () => {
    expect(acceptEmailMatch(parsed(), "someone@example.com", WORKSPACE)).toBe(
      "email-mismatch",
    );
  });

  // TEST_SCENARIO: a person of another workspace is refused, and on an enterprise so is one of another organization, or one whose organization the workspace cannot name.
  it("refuses another workspace and another organization", () => {
    expect(
      acceptEmailMatch(parsed({ team_id: "T0OTHER" }), "owner@example.com", {
        teamId: "T0TEAM",
        enterpriseId: null,
      }),
    ).toBe("other-workspace");
    expect(
      acceptEmailMatch(
        parsed({ enterprise_user: { enterprise_id: "E0FOREIGN" } }),
        "owner@example.com",
        WORKSPACE,
      ),
    ).toBe("other-enterprise");
    expect(
      acceptEmailMatch(
        parsed({ enterprise_user: { enterprise_id: "E0ORG" } }),
        "owner@example.com",
        { teamId: "T0TEAM", enterpriseId: null },
      ),
    ).toBe("other-enterprise");
    expect(
      acceptEmailMatch(parsed(), "owner@example.com", {
        teamId: "T0TEAM",
        enterpriseId: "E0ORG",
      }),
    ).toBe("other-enterprise");
  });

  // TEST_SCENARIO: on an enterprise a person belongs to a workspace through the organization's own list, so a Grid person whose home team differs is still a member here.
  it("accepts a Grid member of the workspace through the organization's list", () => {
    expect(
      acceptEmailMatch(
        parsed({
          team_id: "T0HOME",
          enterprise_user: { enterprise_id: "E0ORG", teams: ["T0TEAM"] },
        }),
        "owner@example.com",
        WORKSPACE,
      ),
    ).toBeNull();
  });

  // TEST_SCENARIO: every account Slack does not vouch for as an ordinary member is refused.
  it("refuses the accounts the workspace does not own", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ deleted: true }, "deleted"],
      [{ is_bot: true }, "bot"],
      [{ is_app_user: true }, "app-user"],
      [{ is_restricted: true }, "guest"],
      [{ is_ultra_restricted: true }, "guest"],
      [{ is_stranger: true }, "external"],
      [
        { enterprise_user: { enterprise_id: "E0ORG", is_guest: true } },
        "external",
      ],
    ];
    for (const [overrides, reason] of cases) {
      expect(
        acceptEmailMatch(
          parsed({
            enterprise_user: { enterprise_id: "E0ORG" },
            ...overrides,
          }),
          "owner@example.com",
          WORKSPACE,
        ),
        JSON.stringify(overrides),
      ).toBe(reason);
    }
  });
});

describe("the DM and the hello", () => {
  // TEST_SCENARIO: only a 1:1 with the matched person is the owner's DM.
  it("accepts only the 1:1 with that person", () => {
    const dm = {
      isDirectMessage: true,
      isGroupDirectMessage: false,
      directMessageUser: "U0OWNER",
    };
    expect(acceptDirectMessage(dm, "U0OWNER")).toBeNull();
    expect(
      acceptDirectMessage({ ...dm, isGroupDirectMessage: true }, "U0OWNER"),
    ).toBe("not-a-dm");
    expect(
      acceptDirectMessage({ ...dm, isDirectMessage: false }, "U0OWNER"),
    ).toBe("not-a-dm");
    expect(acceptDirectMessage(dm, "U0OTHER")).toBe("dm-with-someone-else");
  });

  // TEST_SCENARIO: an unknown grant set is not a grant.
  it("treats an unknown scope set as missing every scope", () => {
    expect(missingRequiredScopes(null)).toContain("im:write");
    expect(missingRequiredScopes(["chat:write"])).toEqual(
      expect.arrayContaining([
        "users:read",
        "users:read.email",
        "im:read",
        "im:write",
        "im:history",
      ]),
    );
  });

  // TEST_SCENARIO: the hello names the unbind command this DM can actually run — bare while this agent is alone there, qualified when another is bound too.
  it("advertises an unbind its DM can resolve", () => {
    const alone = slackDmHello({
      agentName: "Dammy",
      brandShort: "dam",
      isDefault: true,
      otherAgentsBound: false,
    });
    expect(alone).toContain("Type `/dam unbind` here.");
    expect(alone).not.toContain("Start a message with");

    const shared = slackDmHello({
      agentName: "Dammy",
      brandShort: "dam",
      purpose: "your Friday draft",
      isDefault: false,
      otherAgentsBound: true,
    });
    expect(shared).toContain("Type `/dam unbind Dammy` here.");
    expect(shared).toContain("I'll send you your Friday draft here");
    expect(shared).toContain("Start a message with Dammy to reach me.");
  });
});
