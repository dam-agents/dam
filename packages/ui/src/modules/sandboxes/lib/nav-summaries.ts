import type { Schedule } from "../../../types.js";
import { isPastOnce } from "../../schedules/lib/once-schedule.js";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the agent's navigation counts the skills in effect
 * — the ones switched on from a source plus the ones the agent carries of its
 * own, from the platform, its image or its owner — so a kit's skills are not
 * "None enabled" beside a page that shows them; the page's own header counts
 * every skill each source offers, which is another question.
 */
export function skillsNavSummary(
  state: { installed: readonly unknown[]; standalone: readonly unknown[] },
  sourceCount: number | null,
): string {
  const total = state.installed.length + state.standalone.length;
  if (total === 0 && !sourceCount) return "None yet";
  const skills = total === 0 ? "None enabled" : plural(total, "skill");
  return sourceCount ? `${skills} · ${plural(sourceCount, "source")}` : skills;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the agent's navigation counts the schedules its
 * Schedules page lists — a paused one is listed while it is not upcoming — and
 * leaves out the past one-time tasks the page already folds into its own group.
 */
export function schedulesNavSummary(schedules: readonly Schedule[]): string {
  const listed = schedules.filter((schedule) => !isPastOnce(schedule)).length;
  return listed === 0 ? "No schedules" : plural(listed, "schedule");
}
