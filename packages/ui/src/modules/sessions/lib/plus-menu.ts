import type { Schedule } from "../../../types.js";

export type PlusMenuPanel = "skills" | "schedules" | "connections";

/** UNIT_BOUNDARY_DESCRIPTION: a dialog the + menu opens once it has closed, so the dialog is never drawn under the menu or dismissed with it: an add flow, or the editor of one listed schedule. */
export type PlusMenuDialog =
  | { kind: "add-skill-source" }
  | { kind: "add-schedule" }
  | { kind: "edit-schedule"; schedule: Schedule }
  | { kind: "add-connection" };

export const DESCRIBE_PROMPTS = {
  skills: "Create a skill that...",
  schedules: "Every morning at 9am...",
} as const satisfies Partial<Record<PlusMenuPanel, string>>;

export function countBadge(
  count: number | undefined,
  unit?: string,
): string | undefined {
  if (!count) return undefined;
  return unit ? `${count} ${unit}` : String(count);
}
