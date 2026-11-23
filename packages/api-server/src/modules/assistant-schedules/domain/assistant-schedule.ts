/**
 * UNIT_BOUNDARY_DESCRIPTION: one kind of Schedule the platform gives a
 * person's assistant: what the person reads it as, when it recurs for one
 * owner, and the task of each run. A new default Schedule is a new
 * definition; the service and the table that keep it are shared. The person
 * chooses a level, which decides the task of a run and the settings its
 * Session asks its harness for; a kind with one level names it as the
 * default and ignores the argument. `formerNames` are the names an earlier
 * release gave the Schedule and its Sessions, so a Schedule still under one
 * gets the current name, and one its owner named keeps theirs.
 */
export interface AssistantScheduleDefinition {
  kind: string;
  subject: string;
  name: string;
  formerNames: readonly string[];
  sessionTitle: string;
  timezone: string;
  rule: (owner: string) => string;
  defaultLevel: string;
  task: (level: string) => string;
  settings: (level: string) => Record<string, string>;
}

const DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = DAYS.length * MINUTES_PER_DAY;
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function hashOf(text: string): number {
  let hash = FNV_OFFSET;
  for (const char of text)
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), FNV_PRIME) >>> 0;
  return hash;
}

export function weeklyRuleFor(owner: string, kind: string): string {
  const minuteOfWeek = hashOf(`${kind}:${owner}`) % MINUTES_PER_WEEK;
  const day = DAYS[Math.floor(minuteOfWeek / MINUTES_PER_DAY)] ?? DAYS[0];
  const minuteOfDay = minuteOfWeek % MINUTES_PER_DAY;
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `FREQ=WEEKLY;BYDAY=${day};BYHOUR=${String(hour)};BYMINUTE=${String(minute)}`;
}
