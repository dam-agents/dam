// TEST_OVERVIEW: what `dam approval approve` and `deny` print for a held web search. A durable verdict writes the agent's web search rule, never an egress rule, so the line says what every later search does; a verdict for this search only says so, and an expired hold still reports the rule it wrote.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printOutcomeAndExit } from "../modules/approval/commands/outcome.js";

let stdout = "";

beforeEach(() => {
  stdout = "";
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  });
});

afterEach(() => vi.restoreAllMocks());

const wording = {
  pastTense: "Approved",
  onceLine: "Approved this call only.",
  webSearchRuleLine:
    "every later web search of the agent goes ahead without asking.",
  expiredEffect: "the next request of this shape passes.",
};

describe("a web search verdict's outcome line", () => {
  // TEST_SCENARIO: a durable approve names the web search rule it wrote, not a harness verdict or an egress rule.
  it("names the web search rule a durable verdict wrote", () => {
    expect(() =>
      printOutcomeAndExit(
        { outcome: "applied", type: "web_search", rule: null },
        {},
        wording,
      ),
    ).toThrow("exit 0");
    expect(stdout).toBe(
      "Approved — wrote the agent's web search rule: every later web search of the agent goes ahead without asking.\n",
    );
  });

  // TEST_SCENARIO: a verdict for this search only writes no rule, and says so.
  it("says a once verdict answered only this search", () => {
    expect(() =>
      printOutcomeAndExit(
        { outcome: "applied", type: "web_search", rule: null },
        { once: true },
        wording,
      ),
    ).toThrow("exit 0");
    expect(stdout).toBe("Approved this call only.\n");
  });

  // TEST_SCENARIO: a hold that already expired still takes the rule, and the line says the rule was written anyway.
  it("reports the rule written on an expired hold", () => {
    expect(() =>
      printOutcomeAndExit(
        { outcome: "rule_written_expired", type: "web_search", rule: null },
        {},
        wording,
      ),
    ).toThrow("exit 0");
    expect(stdout).toContain("wrote the agent's web search rule anyway");
  });
});
