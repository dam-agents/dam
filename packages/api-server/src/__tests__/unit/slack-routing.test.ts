import { describe, it, expect } from "vitest";
import {
  defaultOf,
  matchRosterName,
  orderAmbientReaders,
  routeMention,
  stripLeadingMentions,
  type RosterEntry,
} from "../../modules/channels/infrastructure/slack-routing.js";

/**
 * TEST_OVERVIEW: routing a Slack mention to one of the agents connected to the
 * conversation — by name when a name leads the message, otherwise to the
 * conversation's default agent.
 */

function entry(
  name: string,
  opts: { isDefault?: boolean; instanceName?: string } = {},
): RosterEntry {
  return {
    instanceName: opts.instanceName ?? `agent-${name}`,
    name,
    owner: "owner-sub",
    ambient: false,
    isDefault: opts.isDefault ?? false,
  };
}

const roster = [
  entry("Scribe", { isDefault: true }),
  entry("Reviewer"),
  entry("Release Captain"),
];

describe("stripLeadingMentions", () => {
  it("removes the bot tag and following whitespace", () => {
    expect(stripLeadingMentions("<@U123> hello there")).toBe("hello there");
  });

  it("removes several consecutive tags", () => {
    expect(stripLeadingMentions("<@U123> <@U456> hi")).toBe("hi");
  });

  it("leaves a tag that is not at the start alone", () => {
    expect(stripLeadingMentions("ask <@U123> about it")).toBe(
      "ask <@U123> about it",
    );
  });
});

describe("defaultOf", () => {
  it("returns the flagged default", () => {
    expect(defaultOf(roster)?.name).toBe("Scribe");
  });

  /**
   * TEST_SCENARIO: a conversation should always carry a default, but a row set
   * that lost it must still route somewhere rather than dropping the turn.
   */
  it("falls back to the first entry when nothing is flagged", () => {
    expect(defaultOf([entry("Reviewer"), entry("Scribe")])?.name).toBe(
      "Reviewer",
    );
  });

  it("returns null for an empty roster", () => {
    expect(defaultOf([])).toBeNull();
  });
});

describe("routeMention", () => {
  it("routes a bare mention to the default agent", () => {
    const routed = routeMention("<@U123> what is the status?", roster);
    expect(routed?.target.name).toBe("Scribe");
    expect(routed?.addressedByName).toBe(false);
  });

  it("routes to an agent named at the start of the message", () => {
    const routed = routeMention("<@U123> Reviewer please look at this", roster);
    expect(routed?.target.name).toBe("Reviewer");
    expect(routed?.addressedByName).toBe(true);
  });

  it("matches a name case-insensitively", () => {
    expect(routeMention("<@U123> reviewer ping", roster)?.target.name).toBe(
      "Reviewer",
    );
  });

  it("matches a name followed by punctuation", () => {
    expect(routeMention("<@U123> Reviewer: ping", roster)?.target.name).toBe(
      "Reviewer",
    );
  });

  /**
   * TEST_SCENARIO: agent names may contain spaces, so matching cannot stop at
   * the first token.
   */
  it("matches a multi-word name", () => {
    expect(
      routeMention("<@U123> Release Captain, ship it", roster)?.target.name,
    ).toBe("Release Captain");
  });

  /**
   * TEST_SCENARIO: a name must be a whole word — a message that merely starts
   * with the same letters is not addressed to that agent.
   */
  it("does not match a name that is only a prefix of the first word", () => {
    const routed = routeMention("<@U123> Reviewers are late", roster);
    expect(routed?.target.name).toBe("Scribe");
    expect(routed?.addressedByName).toBe(false);
  });

  it("falls back to the default when no name leads the message", () => {
    const routed = routeMention(
      "<@U123> can someone look at the build",
      roster,
    );
    expect(routed?.target.name).toBe("Scribe");
  });

  /**
   * TEST_SCENARIO: agent names are not unique, so two connected agents can
   * share one. Routing to the default keeps the turn moving and reports the
   * ambiguity so the default can explain it.
   */
  it("falls back to the default and reports an ambiguous name", () => {
    const ambiguous = [
      entry("Scribe", { isDefault: true }),
      entry("Reviewer", { instanceName: "agent-a" }),
      entry("Reviewer", { instanceName: "agent-b" }),
    ];
    const routed = routeMention("<@U123> Reviewer take a look", ambiguous);
    expect(routed?.target.name).toBe("Scribe");
    expect(routed?.ambiguousName).toBe("Reviewer");
    expect(routed?.addressedByName).toBe(false);
  });

  // TEST_SCENARIO: when one name is a prefix of another, the longer name wins.
  it("prefers the longest matching name", () => {
    const overlapping = [
      entry("Release", { isDefault: true }),
      entry("Release Captain"),
    ];
    expect(
      routeMention("<@U123> Release Captain ship it", overlapping)?.target.name,
    ).toBe("Release Captain");
    expect(
      routeMention("<@U123> Release notes please", overlapping)?.target.name,
    ).toBe("Release");
  });

  it("returns null when no agent is connected", () => {
    expect(routeMention("<@U123> anyone?", [])).toBeNull();
  });
});

describe("orderAmbientReaders", () => {
  const names = (entries: RosterEntry[]) => entries.map((e) => e.name);

  /**
   * TEST_SCENARIO: the default agent is the conversation's primary — the one an
   * unnamed mention reaches — so it gets first crack at a read-along message.
   */
  it("puts the default agent first", () => {
    const readers = [
      entry("Reviewer"),
      entry("Scribe", { isDefault: true }),
      entry("Release Captain"),
    ];
    expect(names(orderAmbientReaders(readers, () => 0))[0]).toBe("Scribe");
  });

  /**
   * TEST_SCENARIO: beyond the default there is no meaningful order, so the rest
   * are shuffled rather than left in a stable one that would quietly privilege
   * the same agent on every message.
   */
  it("shuffles the non-default agents, driven by the supplied rng", () => {
    const readers = [entry("A"), entry("B"), entry("C")];
    const alwaysSwapWithFirst = () => 0;
    expect(names(orderAmbientReaders(readers, alwaysSwapWithFirst))).toEqual([
      "B",
      "C",
      "A",
    ]);
  });

  it("keeps every reader exactly once, whatever the shuffle", () => {
    const readers = [
      entry("Scribe", { isDefault: true }),
      entry("A"),
      entry("B"),
      entry("C"),
    ];
    const ordered = orderAmbientReaders(readers, () => 0.99);
    expect(ordered).toHaveLength(4);
    expect(new Set(names(ordered))).toEqual(new Set(["Scribe", "A", "B", "C"]));
  });

  /**
   * TEST_SCENARIO: a default agent with ambient off never reaches this list, so
   * there is no privileged position to award and the order is a plain shuffle.
   */
  it("has no privileged first entry when no reader is the default", () => {
    const readers = [entry("A"), entry("B")];
    expect(names(orderAmbientReaders(readers, () => 0))).toEqual(["B", "A"]);
  });

  it("handles a single reader and an empty list", () => {
    expect(names(orderAmbientReaders([entry("Solo")]))).toEqual(["Solo"]);
    expect(orderAmbientReaders([])).toEqual([]);
  });
});

describe("matchRosterName", () => {
  it("finds one agent by exact name", () => {
    expect(matchRosterName(roster, "Reviewer").matches).toHaveLength(1);
  });

  it("returns every agent sharing a name", () => {
    const dupes = [
      entry("Reviewer", { instanceName: "agent-a" }),
      entry("Reviewer", { instanceName: "agent-b" }),
    ];
    expect(matchRosterName(dupes, "reviewer").matches).toHaveLength(2);
  });

  it("returns nothing for an unknown name", () => {
    expect(matchRosterName(roster, "Nobody").matches).toEqual([]);
  });

  it("returns nothing for an empty candidate", () => {
    expect(matchRosterName(roster, "   ").matches).toEqual([]);
  });
});
