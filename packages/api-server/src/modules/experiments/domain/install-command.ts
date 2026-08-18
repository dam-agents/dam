import { STAGED_SKILLS_DIR } from "agent-runtime-api";
import { EXPERIMENT_SKILL_NAME } from "api-server-api";
import { buildAppendAgentsMdCommand } from "../../agents/index.js";

const SANDBOX_PURPOSE = [
  "## Sandbox purpose",
  "",
  "This sandbox exists to author and run platform Experiments. Treat every",
  "experiment-shaped request (create, plan, set up, or run an experiment,",
  "compare models/prompts/approaches, benchmark, optimize) as a platform",
  `Experiment and invoke the \`${EXPERIMENT_SKILL_NAME}\` skill first.`,
].join("\n");

export function buildExperimentInstallCommand(): string {
  return [
    "set -eu",
    'mkdir -p "$HOME/.claude/commands" "$HOME/.agents/skills"',
    `cp -R "${STAGED_SKILLS_DIR}/commands/." "$HOME/.claude/commands/"`,
    buildAppendAgentsMdCommand(SANDBOX_PURPOSE),
    `cp -R "${STAGED_SKILLS_DIR}/${EXPERIMENT_SKILL_NAME}" "$HOME/.agents/skills/"`,
  ].join("; ");
}
