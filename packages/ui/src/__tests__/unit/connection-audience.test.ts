// TEST_OVERVIEW: Every time an owner gives a Shared Agent a connection, they see who else can ask the agent to use it with their access: the Agent Editors by email, and everyone in the channels the agent is bound to. One dialog names both; the editor warning and the channel warning each have their own "Don't show again", and once one is turned off the catalog shows a notice in its place. A connection is named as the account it acts as when that is known. An agent with no editors and no channels shows nothing new.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConnectionAudienceSentence } from "../../modules/connections/components/connection-audience-sentence.js";
import {
  type AudienceKind,
  audiencesToWarn,
  type ConnectionAudience,
  noticeAudience,
  sharedConnectionTitle,
} from "../../modules/connections/lib/connection-audience.js";
import { connectionLabel } from "../../modules/connections/lib/connection-label.js";
import type { SharedChannel } from "../../modules/sandboxes/lib/shared-channels.js";

const ALICE = "alice@example.com";
const BOB = "bob@example.com";
const TEAM_X: SharedChannel = { kind: "slack-channel", name: "#team-x" };

const none = () => false;
const only =
  (...kinds: AudienceKind[]) =>
  (kind: AudienceKind) =>
    kinds.includes(kind);

const sentence = (audience: ConnectionAudience, uses = "these connections") =>
  renderToStaticMarkup(
    createElement(ConnectionAudienceSentence, { audience, uses }),
  ).replace(/<[^>]+>/g, "");

describe("naming a connection", () => {
  // TEST_SCENARIO: a connection that knows its account reads "GitHub as tomkis"; one that does not reads by its name alone.
  it("adds the account it acts as when that is known", () => {
    expect(connectionLabel({ name: "GitHub", accountLabel: "tomkis" })).toBe(
      "GitHub as tomkis",
    );
    expect(connectionLabel({ name: "Linear" })).toBe("Linear");
  });
});

describe("the warning on adding a connection", () => {
  // TEST_SCENARIO: AC-1 — a Shared Agent with one editor warns about that editor by email, and names the connection being added as its account.
  it("names the editor and the account the connection acts as", () => {
    const audience = { editors: [ALICE], channels: [] };
    expect(audiencesToWarn(audience, none)).toEqual(["editors"]);
    expect(sharedConnectionTitle(audience)).toBe(
      "This connection will be shared with alice@example.com",
    );
    expect(sentence(audience, "GitHub as tomkis")).toBe(
      "Editor alice@example.com can ask this agent to use GitHub as tomkis, with your access.",
    );
  });

  // TEST_SCENARIO: AC-2 — an owner who turned off the channel warning still gets the editor warning on a Shared Agent that is not bound to a channel.
  it("shows the editor warning after the channel warning was turned off", () => {
    expect(
      audiencesToWarn({ editors: [ALICE], channels: [] }, only("channels")),
    ).toEqual(["editors"]);
  });

  // TEST_SCENARIO: AC-3 — an agent with an editor that is also bound to #team-x names both in one dialog, and its "Don't show again" turns off both warnings.
  it("names editors and channels in one dialog", () => {
    const audience = { editors: [ALICE], channels: [TEAM_X] };
    expect(audiencesToWarn(audience, none)).toEqual(["editors", "channels"]);
    expect(sharedConnectionTitle(audience)).toBe(
      "This connection will be shared with alice@example.com and the Slack channel #team-x",
    );
    expect(sentence(audience, "the connections you add")).toBe(
      "Editor alice@example.com, and anyone in the Slack channel #team-x, can ask this agent to use the connections you add, with your access.",
    );
  });

  // TEST_SCENARIO: the combined dialog still shows while one of its warnings is on, and its "Don't show again" turns off only the one it still showed.
  it("shows while either warning is on, and turns off only that one", () => {
    const audience = { editors: [ALICE], channels: [TEAM_X] };
    expect(audiencesToWarn(audience, only("channels"))).toEqual(["editors"]);
    expect(audiencesToWarn(audience, only("editors", "channels"))).toEqual([]);
  });

  // TEST_SCENARIO: AC-11 — an agent with no editors and no channels warns about nothing.
  it("stays quiet for an agent nobody else uses", () => {
    expect(audiencesToWarn({ editors: [], channels: [] }, none)).toEqual([]);
    expect(
      noticeAudience({ editors: [], channels: [] }, only("editors")),
    ).toBeNull();
  });

  // TEST_SCENARIO: while the agent's channels are not known yet, an agent with no editors keeps today's channel warning.
  it("keeps today's channel warning while the channels load", () => {
    const audience = { editors: [], channels: null };
    expect(audiencesToWarn(audience, none)).toEqual(["channels"]);
    expect(sharedConnectionTitle(audience)).toBe(
      "This connection may be shared with a Slack or Telegram chat",
    );
  });
});

describe("the notice in the catalog", () => {
  // TEST_SCENARIO: AC-4 — once the editor warning is turned off, the catalog of a Shared Agent names its editors in a notice instead.
  it("names the editors after their warning was turned off", () => {
    const audience = { editors: [ALICE], channels: [TEAM_X] };
    expect(noticeAudience(audience, only("editors"))).toEqual({
      editors: [ALICE],
      channels: [],
    });
    expect(noticeAudience(audience, none)).toBeNull();
  });
});

describe("the notice on the Connections page", () => {
  // TEST_SCENARIO: AC-5 — a Shared Agent with two editors names both.
  it("names every editor", () => {
    expect(sentence({ editors: [ALICE, BOB], channels: [] })).toBe(
      "Editors alice@example.com and bob@example.com can ask this agent to use these connections, with your access.",
    );
  });

  // TEST_SCENARIO: more than three editors name the first two and count the rest, as the channel names do.
  it("counts editors beyond three", () => {
    const editors = ["a@x.io", "b@x.io", "c@x.io", "d@x.io"];
    expect(sentence({ editors, channels: [] })).toBe(
      "Editors a@x.io, b@x.io, and 2 more can ask this agent to use these connections, with your access.",
    );
  });

  // TEST_SCENARIO: an agent bound to a channel without editors reads as the channel notice did before.
  it("reads as before for channels alone", () => {
    expect(sentence({ editors: [], channels: [TEAM_X] })).toBe(
      "This agent is bound to the Slack channel #team-x. Anyone there can ask it to use these connections, with your access.",
    );
  });
});
