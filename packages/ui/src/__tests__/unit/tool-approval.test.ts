// TEST_OVERVIEW: Tool approval is its own choice, mapped onto each harness's own setting: Claude Code's permission mode (Always ask is Accept edits), Bob's approvals (no Bypass), and Bypass alone for a harness that runs every tool unasked. Plan modes are never offered.
import type { HarnessCapability } from "agent-runtime-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  approvalOption,
  ToolApprovalPicker,
} from "../../modules/sessions/components/tool-approval-picker.js";

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
    expect(approvalOption(claude)?.id).toBe("mode");
    expect(approvalOption(bob)?.id).toBe("approvals");
    expect(approvalOption(pi)).toBeUndefined();
  });

  /** TEST_SCENARIO: Claude's Accept edits reads as Always ask, and a harness without approvals reads as Bypass alone. */
  it("names the harness value by the approval it stands for", () => {
    expect(label(claude, { mode: "acceptEdits" })).toContain("Always ask");
    expect(label(bob, { approvals: "auto" })).toContain("Auto mode");
    expect(label(pi)).toContain("Bypass");
  });
});
