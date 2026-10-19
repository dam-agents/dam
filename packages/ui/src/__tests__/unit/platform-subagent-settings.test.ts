import type { HarnessCapability } from "agent-runtime-api";
import { describe, expect, it } from "vitest";

import {
  platformHarnessChange,
  platformModelChange,
  platformSubagentOptions,
} from "../../modules/sessions/lib/platform-subagent-settings.js";

/**
 * TEST_OVERVIEW: The platform sub-agent rows offer only what an unattended
 * sub-agent on the chosen harness can take, and a change of harness or model
 * clears the values the new choice cannot hold, which the spawn would
 * otherwise refuse.
 */
const claudeCode: HarnessCapability = {
  name: "claude-code",
  harnessConfig: true,
  sessionModel: true,
  sessionSettings: ["mode", "effort", "subagentEffort"],
  harnessConfigCatalog: {
    options: [
      { id: "model", name: "Model", category: "model", choices: [] },
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        choices: [
          { value: "default", name: "Ask", needsApproval: true },
          { value: "bypassPermissions", name: "Bypass" },
        ],
      },
      {
        id: "effort",
        name: "Effort",
        category: "thought_level",
        choices: [{ value: "high", name: "High" }],
      },
      {
        id: "subagentEffort",
        name: "Subagent effort",
        category: "thought_level",
        subagents: true,
        choices: [{ value: "low", name: "Low" }],
      },
    ],
    modelConstraints: { haiku: { effort: [] } },
  },
};

describe("platform sub-agent choices", () => {
  /** TEST_SCENARIO: The rows leave out the model option, the harness's own
   * subagent settings and a mode that waits for an approval; on Haiku the
   * effort row, left with no choice, goes too. Picking Haiku clears a set
   * effort and keeps the mode; picking another harness clears every value. */
  it("offers what the harness can take and clears what a change cannot hold", () => {
    const offered = (model?: string) =>
      platformSubagentOptions(claudeCode, model).map((o) => [
        o.id,
        o.choices.map((c) => c.value),
      ]);
    expect(offered()).toEqual([
      ["mode", ["bypassPermissions"]],
      ["effort", ["high"]],
    ]);
    expect(offered("anthropic/claude-haiku-4-5")).toEqual([
      ["mode", ["bypassPermissions"]],
    ]);

    const settings = {
      "platformSubagent.harness": "claude-code",
      "platformSubagent.mode": "bypassPermissions",
      "platformSubagent.effort": "high",
    };
    expect(
      platformModelChange(
        claudeCode.harnessConfigCatalog,
        settings,
        "anthropic/claude-haiku-4-5",
      ),
    ).toEqual({
      "platformSubagent.effort": "",
      "platformSubagent.model": "anthropic/claude-haiku-4-5",
    });
    expect(platformHarnessChange(settings, "codex")).toEqual({
      "platformSubagent.harness": "codex",
      "platformSubagent.mode": "",
      "platformSubagent.effort": "",
    });
  });
});
