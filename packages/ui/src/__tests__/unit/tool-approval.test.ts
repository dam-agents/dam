// TEST_OVERVIEW: Tool approval is its own choice, mapped onto each harness's own setting: Claude Code's permission mode (Always ask is Accept edits), Bob's approvals (no Bypass) and Copilot's mode, whose Autopilot is Auto mode. A harness with one choice or none shows no picker. Plan modes are never offered.
import {
  approvalOption,
  COPILOT_AUTOPILOT,
  type HarnessCapability,
} from "agent-runtime-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToolApprovalPicker } from "../../modules/sessions/components/tool-approval-picker.js";

const harness = (
  options: { id: string; category: string; values: string[] }[],
) =>
  ({
    name: "h",
    harnessConfigCatalog: {
      options: options.map((o) => ({
        id: o.id,
        name: o.id,
        category: o.category,
        choices: o.values.map((value) => ({ value, name: value })),
      })),
    },
  }) as unknown as HarnessCapability;

const claude = harness([
  {
    id: "mode",
    category: "mode",
    values: ["auto", "default", "acceptEdits", "plan", "bypassPermissions"],
  },
]);
const bob = harness([
  { id: "mode", category: "mode", values: ["agent", "plan", "ask"] },
  { id: "approvals", category: "approvals", values: ["auto", "ask"] },
]);
const copilot = harness([
  {
    id: "mode",
    category: "mode",
    values: [
      "https://agentclientprotocol.com/protocol/session-modes#agent",
      "https://agentclientprotocol.com/protocol/session-modes#plan",
      COPILOT_AUTOPILOT,
    ],
  },
]);
const pi = harness([
  { id: "mode", category: "thought_level", values: ["low", "high"] },
]);

const label = (capability: HarnessCapability, settings = {}) =>
  renderToStaticMarkup(
    createElement(ToolApprovalPicker, {
      capability,
      settings,
      onChange: () => {},
    }),
  );

describe("tool approval", () => {
  /** TEST_SCENARIO: each harness's approval lives in its own option, and Pi's thinking level is not one. */
  it("finds the option that holds approval", () => {
    expect(approvalOption(claude.harnessConfigCatalog)?.id).toBe("mode");
    expect(approvalOption(bob.harnessConfigCatalog)?.id).toBe("approvals");
    expect(approvalOption(copilot.harnessConfigCatalog)?.id).toBe("mode");
    expect(approvalOption(pi.harnessConfigCatalog)).toBeUndefined();
  });

  /** TEST_SCENARIO: a session that picked nothing runs on Auto mode, whatever a default says; Claude's Accept edits reads as Always ask. */
  it("names the harness value by the approval it stands for", () => {
    expect(label(claude)).toContain("Auto mode");
    expect(label(claude, { mode: "acceptEdits" })).toContain("Always ask");
    expect(label(bob, { approvals: "auto" })).toContain("Auto mode");
  });

  /** TEST_SCENARIO: Copilot's Autopilot is its Auto mode, and its only approval choice, so Copilot shows no picker; nor does Pi, which has none. */
  it("shows no picker for a harness with one choice or none", () => {
    expect(label(copilot)).toBe("");
    expect(label(pi)).toBe("");
  });
});
