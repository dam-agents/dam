import { STAGED_SKILLS_DIR } from "agent-runtime-api";

/* UNIT_BOUNDARY_DESCRIPTION: where the image keeps the CLI it carries — beside
 * its staged skills but outside them, so the skill's content hash is the
 * `SKILL.md` the repo ships and never a build artifact. */
const IMAGE_CLI_PATH = "/usr/local/lib/dam/dam.mjs";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Install Command an Agent Kind runs, and the
 * only way the staged `dam` skill reaches an agent. It copies the image's
 * staged skill into the one Skill Path every image has, so the assistant reads
 * it as a skill of this platform, and writes `dam` onto its PATH as a two-line
 * wrapper over the image's own bundle — pointed at this install's harness base
 * and its own Agent id, which are the only two things that differ per agent.
 * Nothing is downloaded and nothing secret exists: the wrapper talks to the
 * path the machine already proves it is.
 */
export function cliInstallCommand(input: {
  agentId: string;
  harnessUrl: string;
}): string {
  const base = input.harnessUrl.replace(/\/+$/, "");
  const skill = `${STAGED_SKILLS_DIR}/dam`;
  return [
    "set -eu",
    'mkdir -p "$HOME/bin" "$HOME/.agents/skills"',
    `rm -rf "$HOME/.agents/skills/dam"`,
    `cp -R ${shellQuote(skill)} "$HOME/.agents/skills/dam"`,
    "cat > \"$HOME/bin/dam\" <<'DAM_WRAPPER_EOF'",
    "#!/bin/sh",
    `DAM_HARNESS_URL=${shellQuote(base)}`,
    `DAM_AGENT_ID=${shellQuote(input.agentId)}`,
    "export DAM_HARNESS_URL DAM_AGENT_ID",
    `exec node ${shellQuote(IMAGE_CLI_PATH)} "$@"`,
    "DAM_WRAPPER_EOF",
    'chmod +x "$HOME/bin/dam"',
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
