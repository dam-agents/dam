import { STAGED_SKILLS_DIR } from "agent-runtime-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Install Command an Agent Kind runs, and the
 * only way the staged `dam` skill reaches an agent. It copies the image's
 * staged skill into the one Skill Path every image has, so the assistant reads
 * it as a skill of this platform, and writes the two values that point `dam` at
 * this install's harness base and at its own Agent id — the only two things that
 * differ per agent, and all that the image's `/usr/local/bin/dam` needs to
 * become this machine's CLI. Nothing is downloaded and nothing secret exists:
 * the CLI talks to the path the machine already proves it is.
 */
export function cliInstallCommand(input: {
  agentId: string;
  harnessUrl: string;
}): string {
  const base = input.harnessUrl.replace(/\/+$/, "");
  const skill = `${STAGED_SKILLS_DIR}/dam`;
  return [
    "set -eu",
    'mkdir -p "$HOME/.agents/skills" "$HOME/.dam"',
    `rm -rf "$HOME/.agents/skills/dam"`,
    `cp -R ${shellQuote(skill)} "$HOME/.agents/skills/dam"`,
    `printf '%s\\n' ${shellQuote(`DAM_HARNESS_URL=${shellQuote(base)}`)} ${shellQuote(`DAM_AGENT_ID=${shellQuote(input.agentId)}`)} > "$HOME/.dam/harness.env"`,
    'chmod 600 "$HOME/.dam/harness.env"',
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
