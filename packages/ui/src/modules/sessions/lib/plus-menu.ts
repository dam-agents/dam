export type PlusMenuPanel = "skills" | "schedules" | "connections";

export type PlusMenuDialog =
  "add-skill-source" | "add-schedule" | "add-connection";

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
