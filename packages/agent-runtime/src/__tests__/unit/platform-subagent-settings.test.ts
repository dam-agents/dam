import { describe, expect, it } from "vitest";
import {
  type HarnessConfigCatalog,
  platformSubagentSettingsError,
} from "agent-runtime-api";

/**
 * TEST_OVERVIEW: A session's platform sub-agent settings are checked against
 * the chosen harness's catalog when they are set, so a value the sub-agent
 * could never run with is refused then, not at every spawn.
 */
const codex: HarnessConfigCatalog = {
  options: [
    {
      id: "effort",
      name: "Effort",
      category: "thought_level",
      choices: [
        { value: "minimal", name: "Minimal" },
        { value: "high", name: "High" },
      ],
    },
    {
      id: "approvals",
      name: "Approvals",
      category: "approvals",
      choices: [
        { value: "auto", name: "Auto" },
        { value: "ask", name: "Ask", needsApproval: true },
      ],
    },
  ],
  modelConstraints: { mini: { effort: ["high"] } },
};
const check = (settings: Record<string, string>) =>
  platformSubagentSettingsError(settings, (h) =>
    h === "codex" ? codex : undefined,
  );

describe("platformSubagentSettingsError", () => {
  /** TEST_SCENARIO: A value needs a harness to be judged against; a value
   * the harness does not offer, one that waits for an approval nobody gives,
   * and one the set model excludes are refused. A harness the agent no
   * longer carries is left to the spawn, so it never blocks the session's
   * other settings. */
  it("refuses what the sub-agent could never run with", () => {
    expect(check({ "platformSubagent.effort": "high" })).toMatch(
      /need a harness/,
    );
    expect(
      check({
        "platformSubagent.harness": "codex",
        "platformSubagent.effort": "xhigh",
      }),
    ).toMatch(/Unsupported platform sub-agent setting: effort=xhigh/);
    expect(
      check({
        "platformSubagent.harness": "codex",
        "platformSubagent.approvals": "ask",
      }),
    ).toMatch(/nobody is there to give/);
    expect(
      check({
        "platformSubagent.harness": "codex",
        "platformSubagent.model": "openai/gpt-5-mini",
        "platformSubagent.effort": "minimal",
      }),
    ).toMatch(/not available for openai\/gpt-5-mini/);
    expect(
      check({
        "platformSubagent.harness": "codex",
        "platformSubagent.model": "openai/gpt-5-mini",
        "platformSubagent.effort": "high",
        "platformSubagent.approvals": "auto",
      }),
    ).toBeUndefined();
    expect(
      check({
        "platformSubagent.harness": "gone",
        "platformSubagent.effort": "high",
      }),
    ).toBeUndefined();
  });
});
