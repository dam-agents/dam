// TEST_OVERVIEW: a new agent's default name is a posh butler name the user
// TEST_OVERVIEW: does not already use for one of their agents, compared
// TEST_OVERVIEW: case-insensitively; and once every butler name is used, the default falls back to agent, agent-2, ...
import { describe, expect, test } from "vitest";

import { BUTLER_NAMES } from "../../modules/agents/lib/butler-names.js";
import { nextAgentName } from "../../modules/agents/lib/sandbox-name.js";

const first = () => 0;
const last = () => 0.999999;

describe("BUTLER_NAMES", () => {
  test("holds well over a hundred distinct capitalised first names", () => {
    expect(BUTLER_NAMES.length).toBeGreaterThanOrEqual(100);
    expect(new Set(BUTLER_NAMES.map((n) => n.toLowerCase())).size).toBe(
      BUTLER_NAMES.length,
    );
    for (const name of BUTLER_NAMES) expect(name).toMatch(/^[A-Z][a-z]+$/);
  });
});

describe("nextAgentName", () => {
  test("picks a butler name at random", () => {
    expect(nextAgentName([], { random: first })).toBe(BUTLER_NAMES[0]);
    expect(nextAgentName([], { random: last })).toBe(
      BUTLER_NAMES[BUTLER_NAMES.length - 1],
    );
  });

  // TEST_SCENARIO: the user already has agents named after the first butler names, in another case and with stray spaces; the pick skips them all.
  test("never picks a name the user already uses, whatever its case", () => {
    const [a, b] = BUTLER_NAMES;
    expect(
      nextAgentName([` ${a.toUpperCase()} `, b.toLowerCase()], {
        random: first,
      }),
    ).toBe(BUTLER_NAMES[2]);
  });

  test("never picks a used name, over many random draws", () => {
    const taken = BUTLER_NAMES.slice(0, -3).map((n) => n.toLowerCase());
    for (let i = 0; i < 50; i++)
      expect(BUTLER_NAMES.slice(-3)).toContain(nextAgentName(taken));
  });

  // TEST_SCENARIO: the user has used every butler name, so the default goes back to the agent, agent-2, ... scheme, counting from the agent-N names already taken.
  test("falls back to agent-N once every butler name is used", () => {
    expect(nextAgentName(BUTLER_NAMES)).toBe("agent");
    expect(nextAgentName([...BUTLER_NAMES, "agent", "Agent-2"])).toBe(
      "agent-3",
    );
  });
});
