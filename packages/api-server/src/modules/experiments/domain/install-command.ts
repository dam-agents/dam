import { EXPERIMENT_SKILL_NAME } from "api-server-api";

/** Outside `/app/working-dir` so the first-boot `cp -rn` never seeds it into a
 *  plain sandbox. Must match the COPY in packages/agents/claude-code/Dockerfile. */
const STAGED_KIT_DIR = "/usr/local/share/dam-skills";

/** Copies the authoring kit out of the image — nothing fetched, unlike a KB
 *  bootstrap. Order is load-bearing: command first, skill last, so the skill
 *  appearing in `skills.state.standalone` implies the command is there too. */
export function buildExperimentInstallCommand(): string {
  return [
    "set -eu",
    'mkdir -p "$HOME/.claude/commands" "$HOME/.agents/skills"',
    `cp -R "${STAGED_KIT_DIR}/commands/." "$HOME/.claude/commands/"`,
    `cp -R "${STAGED_KIT_DIR}/${EXPERIMENT_SKILL_NAME}" "$HOME/.agents/skills/"`,
  ].join("; ");
}
