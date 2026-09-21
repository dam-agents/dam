// TEST_OVERVIEW: a command a kit or bootstrap names has to reach the harness spelled the way that harness expands installed commands — Codex namespaces them under /prompts:, the others take the bare slash command — or the initialization session opens on a command the harness does not know.
import type { HarnessFamily } from "api-server-api";
import { describe, expect, it } from "vitest";

import { spellHarnessCommand } from "../../modules/templates/domain/harness-command.js";

describe("spellHarnessCommand", () => {
  it("namespaces the command for Codex", () => {
    expect(spellHarnessCommand("wiki-onboard", "codex")).toBe(
      "/prompts:wiki-onboard",
    );
  });

  it("uses the bare command for every other harness and for an unknown one", () => {
    for (const h of ["claude-code", "pi", "bob"] as HarnessFamily[]) {
      expect(spellHarnessCommand("wiki-onboard", h)).toBe("/wiki-onboard");
    }
    expect(spellHarnessCommand("wiki-onboard", undefined)).toBe(
      "/wiki-onboard",
    );
  });
});
