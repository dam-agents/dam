// TEST_OVERVIEW: The command palette ranks a command by how well the typed words match it, multiplied by a boost from its pre-score, how often and how lately this browser ran it, how lately its agent or session was active, whether it belongs to the agent open on the page, and whether it is the configuration section open on the page for another agent.
import { describe, expect, it } from "vitest";

import {
  fuzzyScore,
  halfLifeDecay,
  matchScore,
  type Rankable,
  rankCommands,
  RANKING,
  type RankingContext,
  scoreCommand,
} from "../../modules/command-palette/lib/ranking.js";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const DAY = 86_400_000;

const ctx = (over: Partial<RankingContext> = {}): RankingContext => ({
  now: NOW,
  agentId: null,
  action: null,
  frecency: () => 0,
  ...over,
});

const cmd = (text: string, over: Partial<Rankable> = {}): Rankable => ({
  id: text,
  text,
  prior: 0.5,
  ...over,
});

const order = (list: Rankable[], query: string, c = ctx()) =>
  rankCommands(list, query, c).map((r) => r.id);

describe("fuzzy match", () => {
  // TEST_SCENARIO: words typed in any order find a command, so "prov alice" finds Alice's Providers page as well as "alice prov" does.
  it("matches every word in any order", () => {
    const text = "agent Alice: configure Providers";
    expect(fuzzyScore(text, "prov alice")).toBeGreaterThan(0.8);
    expect(fuzzyScore(text, "prov alice")).toBeCloseTo(
      fuzzyScore(text, "alice prov"),
    );
  });

  // TEST_SCENARIO: typed letters that start words win over the same letters run together inside a word, so "ar" finds "agent: remove" before "start", with or without the space after the colon.
  it("favours word beginnings over a run inside a word", () => {
    expect(order([cmd("start"), cmd("agent: remove")], "ar")).toEqual([
      "agent: remove",
      "start",
    ]);
    expect(order([cmd("start"), cmd("agent:remove")], "ar")).toEqual([
      "agent:remove",
      "start",
    ]);
    expect(
      order([cmd("instance"), cmd("insights"), cmd("new session")], "ns"),
    ).toEqual(["new session", "insights", "instance"]);
  });

  // TEST_SCENARIO: a camelCase hump, a dash, an underscore and a slash start a word just as a space does.
  it("treats humps and separators as word starts", () => {
    for (const text of ["goToHome", "go-to-home", "go_to_home", "go/to/home"])
      expect(matchScore(text, "gth")).toBeGreaterThan(0.75);
    expect(matchScore("APIKeys", "ak")).toBeGreaterThan(0.75);
    expect(matchScore("dogtothome", "gth")).toBeLessThan(0.05);
  });

  // TEST_SCENARIO: an exact prefix beats the same word later in the text, and the whole text beats a longer one it begins.
  it("ranks an exact prefix first", () => {
    expect(
      order([cmd("agent: new session"), cmd("new session"), cmd("new")], "new"),
    ).toEqual(["new", "new session", "agent: new session"]);
    expect(matchScore("session", "ses")).toBeGreaterThan(
      matchScore("new session", "ses"),
    );
  });

  // TEST_SCENARIO: letters together inside a word still beat the same letters scattered through one.
  it("ranks a run inside a word above scattered letters", () => {
    expect(order([cmd("cabinetry"), cmd("start")], "ar")).toEqual([
      "start",
      "cabinetry",
    ]);
  });

  // TEST_SCENARIO: one word that matches nothing drops the command, however well the other words match.
  it("drops a command when one word does not match", () => {
    expect(fuzzyScore("agent Alice: configure Providers", "prov zzz")).toBe(0);
    expect(order([cmd("settings: Providers")], "zzz")).toEqual([]);
  });

  // TEST_SCENARIO: with nothing typed every command matches fully, so only the boosts order the list.
  it("treats an empty query as a full match", () => {
    expect(fuzzyScore("anything", "   ")).toBe(1);
  });

  // TEST_SCENARIO: a word-start match beats a mid-word one even when the mid-word command carries the largest boosts, since the match is squared.
  it("keeps a real match above a mid-word one with every boost", () => {
    const boosted = cmd("agent Alice: approved reports", {
      prior: 1,
      agentId: "alice",
      activityAt: NOW,
    });
    const plain = cmd("settings: Providers");
    expect(
      order(
        [boosted, plain],
        "prov",
        ctx({ agentId: "alice", frecency: () => 100 }),
      ),
    ).toEqual(["settings: Providers", "agent Alice: approved reports"]);
  });
});

describe("signals", () => {
  // TEST_SCENARIO: at equal match a destructive command ranks below a neutral one, which ranks below a frequent action.
  it("orders by pre-score", () => {
    const list = [
      cmd("agent Bob: delete", { prior: RANKING.PRIOR.destructive }),
      cmd("agent Bob: configure", { prior: RANKING.PRIOR.configure }),
      cmd("agent Bob: new session", { prior: RANKING.PRIOR.newSession }),
    ];
    expect(order(list, "bob")).toEqual([
      "agent Bob: new session",
      "agent Bob: configure",
      "agent Bob: delete",
    ]);
  });

  // TEST_SCENARIO: a command this browser runs often moves ahead of an equal one, and the frecency weight saturates instead of growing without bound.
  it("lifts frequently run commands and saturates", () => {
    const list = [cmd("settings: Account"), cmd("settings: API keys")];
    const uses = (id: string) => (id === "settings: API keys" ? 3 : 0);
    expect(order(list, "settings", ctx({ frecency: uses }))).toEqual([
      "settings: API keys",
      "settings: Account",
    ]);
    const at = (n: number) =>
      scoreCommand(cmd("x"), "", ctx({ frecency: () => n }));
    expect(at(3) - at(0)).toBeCloseTo(RANKING.W_FRECENCY * 0.5);
    expect(at(1e6) - at(0)).toBeLessThan(RANKING.W_FRECENCY);
  });

  // TEST_SCENARIO: of two sessions, the one active today ranks above last week's.
  it("lifts recently active sessions", () => {
    const list = [
      cmd('agent A: session "old"', { activityAt: NOW - 7 * DAY }),
      cmd('agent A: session "new"', { activityAt: NOW - DAY / 24 }),
    ];
    expect(order(list, "session")).toEqual([
      'agent A: session "new"',
      'agent A: session "old"',
    ]);
    expect(
      halfLifeDecay(RANKING.RECENCY_HALF_LIFE_MS, RANKING.RECENCY_HALF_LIFE_MS),
    ).toBe(0.5);
    expect(halfLifeDecay(-DAY, RANKING.RECENCY_HALF_LIFE_MS)).toBe(1);
  });

  // TEST_SCENARIO: with an agent's chat open, its own sessions and configuration pages rank above another agent's.
  it("lifts the open agent's commands", () => {
    const list = [
      cmd("agent Bob: configure Skills", { agentId: "bob" }),
      cmd("agent Alice: configure Skills", { agentId: "alice" }),
    ];
    expect(order(list, "skills", ctx({ agentId: "alice" }))).toEqual([
      "agent Alice: configure Skills",
      "agent Bob: configure Skills",
    ]);
  });

  // TEST_SCENARIO: on Alice's Providers page, the Providers page of every other agent ranks above both their other pages and the global Providers setting.
  it("lifts the same configuration section of other agents", () => {
    const list = [
      cmd("settings: Providers"),
      cmd("agent Bob: configure Providers", {
        agentId: "bob",
        action: "configure:providers",
      }),
      cmd("agent Alice: configure Channels", {
        agentId: "alice",
        action: "configure:channels",
      }),
      cmd("agent Provisioner: new session", {
        agentId: "prov",
        prior: RANKING.PRIOR.newSession,
        activityAt: NOW - DAY,
      }),
    ];
    const here = ctx({ agentId: "alice", action: "configure:providers" });
    expect(order(list, "prov", here)).toEqual([
      "agent Bob: configure Providers",
      "agent Provisioner: new session",
      "settings: Providers",
    ]);
  });

  // TEST_SCENARIO: the cross-agent boost is for other agents only; a command without an agent never takes it.
  it("does not give the cross-agent boost to the open agent or to global commands", () => {
    const here = ctx({ agentId: "alice", action: "configure:providers" });
    const own = scoreCommand(
      cmd("a", { agentId: "alice", action: "configure:providers" }),
      "",
      here,
    );
    const global = scoreCommand(
      cmd("b", { action: "configure:providers" }),
      "",
      here,
    );
    expect(own).toBeCloseTo(1 + RANKING.W_CONTEXT);
    expect(global).toBeCloseTo(1);
  });
});

describe("destructive commands", () => {
  // TEST_SCENARIO: with nothing typed no destructive command is suggested at all, however close it is to the open page; on a shared agent's page Leave would otherwise outrank every global command.
  it("are not suggested on an empty query", () => {
    const leave = cmd("agent Carol: leave", {
      agentId: "carol",
      prior: RANKING.PRIOR.destructive,
      destructive: true,
    });
    const here = ctx({ agentId: "carol" });
    expect(order([leave, cmd("agent: new")], "", here)).toEqual(["agent: new"]);
    expect(order([leave], "leave", here)).toEqual(["agent Carol: leave"]);
  });

  // TEST_SCENARIO: running Deny all before, even if its confirmation was cancelled, never lifts it above the harmless Open panel for the same query.
  it("take no frecency", () => {
    const list = [
      cmd("approvals: deny all", {
        prior: RANKING.PRIOR.denyAll,
        destructive: true,
      }),
      cmd("approvals: open panel", { prior: RANKING.PRIOR.approvalsPanel }),
    ];
    const habit = ctx({ frecency: () => 50 });
    expect(order(list, "approvals", habit)).toEqual([
      "approvals: open panel",
      "approvals: deny all",
    ]);
  });
});

// TEST_SCENARIO: the result list stops at its cap and breaks ties on the title.
it("caps the list and breaks ties alphabetically", () => {
  const list = Array.from({ length: RANKING.MAX_RESULTS + 10 }, (_, i) =>
    cmd(`item ${String(i).padStart(3, "0")}`),
  );
  const ranked = order(list, "item");
  expect(ranked).toHaveLength(RANKING.MAX_RESULTS);
  expect(ranked[0]).toBe("item 000");
});
