// TEST_OVERVIEW: a new agent's default name is a posh household-staff name,
// TEST_OVERVIEW: half of them female and half male, that the user does not
// TEST_OVERVIEW: already use for one of their agents, compared
// TEST_OVERVIEW: case-insensitively; and once every staff name is used, the default falls back to agent, agent-2, ...
import { describe, expect, test } from "vitest";

import {
  FEMALE_STAFF_NAMES,
  HOUSEHOLD_STAFF_NAMES,
  MALE_STAFF_NAMES,
} from "../../modules/agents/lib/household-staff-names.js";
import { nextAgentName } from "../../modules/agents/lib/sandbox-name.js";

const first = () => 0;
const last = () => 0.999999;

describe("HOUSEHOLD_STAFF_NAMES", () => {
  test("holds well over a hundred distinct capitalised first names", () => {
    expect(HOUSEHOLD_STAFF_NAMES.length).toBeGreaterThanOrEqual(100);
    expect(HOUSEHOLD_STAFF_NAMES).toHaveLength(360);
    expect(
      new Set(HOUSEHOLD_STAFF_NAMES.map((n) => n.toLowerCase())).size,
    ).toBe(HOUSEHOLD_STAFF_NAMES.length);
    for (const name of HOUSEHOLD_STAFF_NAMES)
      expect(name).toMatch(/^[A-Z][a-z]+$/);
  });

  test("is half female and half male names", () => {
    expect(FEMALE_STAFF_NAMES).toHaveLength(180);
    expect(MALE_STAFF_NAMES).toHaveLength(180);
    expect(HOUSEHOLD_STAFF_NAMES).toEqual([
      ...MALE_STAFF_NAMES,
      ...FEMALE_STAFF_NAMES,
    ]);
  });
});

describe("nextAgentName", () => {
  test("picks a staff name at random", () => {
    expect(nextAgentName([], { random: first })).toBe(HOUSEHOLD_STAFF_NAMES[0]);
    expect(nextAgentName([], { random: last })).toBe(
      HOUSEHOLD_STAFF_NAMES[HOUSEHOLD_STAFF_NAMES.length - 1],
    );
  });

  // TEST_SCENARIO: the user already has agents named after the first staff names, in another case and with stray spaces; the pick skips them all.
  test("never picks a name the user already uses, whatever its case", () => {
    const [a, b] = HOUSEHOLD_STAFF_NAMES;
    expect(
      nextAgentName([` ${a.toUpperCase()} `, b.toLowerCase()], {
        random: first,
      }),
    ).toBe(HOUSEHOLD_STAFF_NAMES[2]);
  });

  test("never picks a used name, over many random draws", () => {
    const taken = HOUSEHOLD_STAFF_NAMES.slice(0, -3).map((n) =>
      n.toLowerCase(),
    );
    for (let i = 0; i < 50; i++)
      expect(HOUSEHOLD_STAFF_NAMES.slice(-3)).toContain(nextAgentName(taken));
  });

  // TEST_SCENARIO: the user has used every staff name, so the default goes back to the agent, agent-2, ... scheme, counting from the agent-N names already taken.
  test("falls back to agent-N once every staff name is used", () => {
    expect(nextAgentName(HOUSEHOLD_STAFF_NAMES)).toBe("agent");
    expect(nextAgentName([...HOUSEHOLD_STAFF_NAMES, "agent", "Agent-2"])).toBe(
      "agent-3",
    );
  });
});
