import { STAGED_SKILLS_DIR } from "agent-runtime-api";
import { EXPERIMENT_SKILL_NAME } from "api-server-api";

/** Copies the authoring kit out of the image — nothing fetched, unlike a KB
 *  bootstrap. Order is load-bearing: command first, skill last, so the skill
 *  appearing in `skills.state.standalone` implies the command is there too. */
export function buildExperimentInstallCommand(): string {
  return [
    "set -eu",
    'mkdir -p "$HOME/.claude/commands" "$HOME/.agents/skills"',
    `cp -R "${STAGED_SKILLS_DIR}/commands/." "$HOME/.claude/commands/"`,
    `cp -R "${STAGED_SKILLS_DIR}/${EXPERIMENT_SKILL_NAME}" "$HOME/.agents/skills/"`,
  ].join("; ");
}
