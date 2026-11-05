import { describe, expect, it } from "vitest";
import { cliInstallCommand } from "../../modules/agents/domain/cli-install.js";

/**
 * TEST_OVERVIEW: the Install Command an assistant's provisioning runs is the
 * only thing that copies the image's staged `dam` skill onto an agent, so what
 * it must get right is exactly what it touches: the skill into the one Skill
 * Path every image has, and the two values that become that machine's CLI — its
 * install's harness base and its own Agent id — with nothing else of the
 * platform's written and every value quoted.
 */

const command = (input: { harnessUrl?: string; agentId?: string } = {}) =>
  cliInstallCommand({
    agentId: input.agentId ?? "agent-0123456789abcdef",
    harnessUrl:
      input.harnessUrl ??
      "http://platform-apiserver-harness.platform.svc.cluster.local:8080",
  });

const printfLine = (input: { harnessUrl?: string; agentId?: string } = {}) =>
  command(input)
    .split("\n")
    .find((line) => line.startsWith("printf"));

describe("the assistant's CLI install command", () => {
  it("copies the staged skill into the skill path every image has", () => {
    expect(command()).toContain(
      `cp -R '/usr/local/share/dam-skills/dam' "$HOME/.agents/skills/dam"`,
    );
    // UNIT_BOUNDARY_DESCRIPTION: a re-run replaces the copy rather than nesting one inside it.
    expect(command()).toContain(`rm -rf "$HOME/.agents/skills/dam"`);
  });

  it("writes the two values the image's dam reads, and nothing else", () => {
    const line = printfLine({
      harnessUrl: "http://harness.example:8080/",
      agentId: "agent-aaa",
    });
    expect(line).toContain("http://harness.example:8080");
    expect(line).toContain("agent-aaa");
    expect(line).toContain("DAM_HARNESS_URL=");
    expect(line).toContain("DAM_AGENT_ID=");
    expect(line).toContain('"$HOME/.dam/harness.env"');
    // UNIT_BOUNDARY_DESCRIPTION: the values are the machine's own, so the file is the agent's alone.
    expect(command()).toContain('chmod 600 "$HOME/.dam/harness.env"');
  });

  it("writes no executable of its own: the CLI on PATH is the image's", () => {
    expect(command()).not.toMatch(/bin\/dam/);
    expect(command()).not.toContain("node /usr/local/lib/dam/dam.mjs");
  });

  it("quotes a value that would otherwise be shell syntax", () => {
    const line = printfLine({
      harnessUrl: "http://harness.example/$(touch /tmp/pwned)",
    });
    expect(line).toContain("http://harness.example/$(touch /tmp/pwned)");
    // UNIT_BOUNDARY_DESCRIPTION: the value appears once, inside a single-quoted argument.
    expect(line!.split("$(touch /tmp/pwned)").length).toBe(2);
    expect(line!.startsWith("printf '%s\\n' '")).toBe(true);
  });
});
