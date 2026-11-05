import { describe, expect, it } from "vitest";
import { cliInstallCommand } from "../../modules/agents/domain/cli-install.js";

/**
 * TEST_OVERVIEW: the Install Command an assistant's provisioning runs is the
 * only thing that copies the image's staged `dam` skill onto an agent, so what
 * it must get right is exactly what it touches: the skill into the one Skill
 * Path every image has, and `dam` onto PATH as a wrapper over the image's own
 * bundle, carrying this install's harness base and that Agent's own id — with
 * nothing else of the platform's baked in, and the values quoted so a URL can
 * never become shell syntax.
 */

const command = (input: { harnessUrl?: string; agentId?: string } = {}) =>
  cliInstallCommand({
    agentId: input.agentId ?? "agent-0123456789abcdef",
    harnessUrl:
      input.harnessUrl ??
      "http://platform-apiserver-harness.platform.svc.cluster.local:8080",
  });

describe("the assistant's CLI install command", () => {
  it("copies the staged skill into the skill path every image has", () => {
    expect(command()).toContain(
      `cp -R '/usr/local/share/dam-skills/dam' "$HOME/.agents/skills/dam"`,
    );
    // UNIT_BOUNDARY_DESCRIPTION: a re-run replaces the copy rather than nesting one inside it.
    expect(command()).toContain(`rm -rf "$HOME/.agents/skills/dam"`);
  });

  it("puts dam on PATH over the image's own bundle", () => {
    const lines = command().split("\n");
    expect(lines).toContain("#!/bin/sh");
    expect(lines).toContain(`exec node '/usr/local/lib/dam/dam.mjs' "$@"`);
    expect(lines).toContain('chmod +x "$HOME/bin/dam"');
  });

  it("points it at this install and this Agent, and at nothing else", () => {
    const lines = command({
      harnessUrl: "http://harness.example:8080/",
      agentId: "agent-aaa",
    }).split("\n");
    expect(lines).toContain("DAM_HARNESS_URL='http://harness.example:8080'");
    expect(lines).toContain("DAM_AGENT_ID='agent-aaa'");
    expect(lines).toContain("export DAM_HARNESS_URL DAM_AGENT_ID");
    // UNIT_BOUNDARY_DESCRIPTION: the two values the wrapper sets and the heredoc's own delimiter — the export line starts with `export`, so it is not one of them.
    expect(lines.filter((line) => line.startsWith("DAM_"))).toEqual([
      "DAM_HARNESS_URL='http://harness.example:8080'",
      "DAM_AGENT_ID='agent-aaa'",
      "DAM_WRAPPER_EOF",
    ]);
  });

  it("quotes a value that would otherwise be shell syntax", () => {
    const lines = command({
      harnessUrl: "http://harness.example/$(touch /tmp/pwned)",
    }).split("\n");
    expect(lines).toContain(
      `DAM_HARNESS_URL='http://harness.example/$(touch /tmp/pwned)'`,
    );
    expect(
      lines.some(
        (line) =>
          line.includes("touch /tmp/pwned") &&
          !line.startsWith("DAM_HARNESS_URL='"),
      ),
    ).toBe(false);
  });
});
