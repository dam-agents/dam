import { useMemo } from "react";

import { useStore } from "../../../store.js";
import { useSkillsState } from "../../agents/api/skills.js";
import { mergeCommands, type SkillCommand } from "../lib/skill-commands.js";

const SKILL_COMMAND_HARNESSES: ReadonlySet<string> = new Set(["claude-code"]);
const NONE: SkillCommand[] = [];

/**
 * UNIT_BOUNDARY_DESCRIPTION: the commands the chat input offers after a `/`.
 * The harness's own list (ACP `available_commands_update`) of the session on
 * screen comes first. A harness that runs `/<skill-name>` also gets the
 * agent's installed and standalone skills from `skills.state`, so a new chat
 * lists them before the harness has reported anything. That query reads the
 * last recorded state of a sleeping agent and does not wake it. Another
 * harness offers only what it reported, so the list never names a command
 * that harness would not run.
 */
export function useSkillCommands(
  agentId: string | null,
  sessionId: string | null,
  harness: string | null,
): SkillCommand[] {
  const runsSkills = harness !== null && SKILL_COMMAND_HARNESSES.has(harness);
  const { data: state } = useSkillsState(runsSkills ? agentId : null);
  const reported = useStore((s) =>
    sessionId !== null && s.reportedCommands?.sessionId === sessionId
      ? s.reportedCommands.commands
      : NONE,
  );
  return useMemo(() => {
    if (!runsSkills) return reported;
    const skills: SkillCommand[] = [
      ...(state?.standalone ?? []).map((s) => ({
        name: s.name,
        description: s.description,
      })),
      ...(state?.installed ?? []).map((s) => ({
        name: s.name,
        description: "",
      })),
    ];
    return mergeCommands(reported, skills);
  }, [runsSkills, reported, state]);
}
