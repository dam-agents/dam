import {
  type ConnectionTemplateView,
  PROVIDER_TEMPLATE_IDS,
  requirementAccepts,
  rruleToText,
  type StarterKitApplyInput,
  type StarterKitConnectionRequirement,
  type StarterKitSchedule,
  type StarterKitScheduleOverride,
  type StarterKitView,
} from "api-server-api";

import {
  CRON_TIMEZONE,
  cronToText,
} from "../../schedules/lib/schedule-format.js";

export interface StarterKitSetupDraft {
  name: string;
  connectionIds: string[];
  slackChannelIds: string[];
  skippedSchedules: string[];
  scheduleOverrides: StarterKitScheduleOverride[];
}

interface GrantedConnection {
  id: string;
  templateId: string;
  name?: string;
}

export type TemplateIndex = ReadonlyMap<
  string,
  Pick<ConnectionTemplateView, "id" | "name" | "family">
>;

interface RequirementStatus {
  requirement: StarterKitConnectionRequirement;
  satisfied: boolean;
}

function draftConnectionIds(draft: StarterKitSetupDraft): string[] {
  return [...new Set(draft.connectionIds)];
}

export function ownedMatches(
  requirement: StarterKitConnectionRequirement,
  owned: readonly GrantedConnection[],
  templates: TemplateIndex,
): GrantedConnection[] {
  return owned.filter((c) => accepts(requirement, c, templates));
}

export function requirementStatuses(
  kit: Pick<StarterKitView, "connections">,
  draft: StarterKitSetupDraft,
  owned: readonly GrantedConnection[],
  templates: TemplateIndex,
): RequirementStatus[] {
  const granted = new Set(draftConnectionIds(draft));
  const grantedConnections = owned.filter((c) => granted.has(c.id));
  return kit.connections.map((requirement) => ({
    requirement,
    satisfied:
      ownedMatches(requirement, grantedConnections, templates).length > 0,
  }));
}

export function isStarterKitSetupComplete(
  kit: Pick<StarterKitView, "connections">,
  draft: StarterKitSetupDraft,
  owned: readonly GrantedConnection[],
  templates: TemplateIndex,
): boolean {
  if (draft.name.trim().length === 0) return false;
  return requirementStatuses(kit, draft, owned, templates).every(
    (s) => s.satisfied || !s.requirement.required,
  );
}

export function buildStarterKitApplyInput(
  kit: Pick<
    StarterKitView,
    "id" | "catalog" | "connections" | "link" | "version" | "channels"
  >,
  draft: StarterKitSetupDraft,
  owned: readonly GrantedConnection[],
  templates: TemplateIndex,
): StarterKitApplyInput {
  if (!isStarterKitSetupComplete(kit, draft, owned, templates)) {
    throw new Error(
      "cannot build starter kit apply input from an incomplete draft",
    );
  }
  return {
    catalog: kit.catalog,
    kitId: kit.id,
    ...(kit.link ? { link: { url: kit.link.url, commit: kit.version } } : {}),
    name: draft.name.trim(),
    connectionIds: draftConnectionIds(draft),
    slackChannelIds: takesSlackChannels(kit) ? draft.slackChannelIds : [],
    skipSchedules: draft.skippedSchedules,
    scheduleOverrides: draft.scheduleOverrides.filter(
      (o) => !draft.skippedSchedules.includes(o.name),
    ),
  };
}

export function takesSlackChannels(
  kit: Pick<StarterKitView, "channels">,
): boolean {
  return !kit.channels.some(
    (c) => c.type === "slack" && c.conversation === "direct",
  );
}

export function preselectedGrants(
  kit: Pick<StarterKitView, "connections">,
  owned: readonly GrantedConnection[],
  granted: readonly string[],
  templates: TemplateIndex,
): string[] {
  const grantedSet = new Set(granted);
  const out: string[] = [];
  for (const requirement of kit.connections) {
    if (!requirement.required) continue;
    const matches = ownedMatches(requirement, owned, templates);
    if (matches.length !== 1) continue;
    if (matches.some((c) => grantedSet.has(c.id))) continue;
    out.push(matches[0].id);
  }
  return out;
}

const FULL_SHA = /^[0-9a-f]{40}$/;

export function shortKitVersion(version: string): string {
  return FULL_SHA.test(version) ? version.slice(0, 9) : version;
}

const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

function shellWord(word: string): string {
  return PLAIN_WORD.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

export function startupItemCommandLine(
  item: Pick<StarterKitView["startupItems"][number], "command" | "args">,
): string {
  return [item.command, ...item.args.map(shellWord)].join(" ");
}

export function isProviderRequirement(
  requirement: StarterKitConnectionRequirement,
): boolean {
  return requirement.accepts.some((id) => PROVIDER_TEMPLATE_IDS.has(id));
}

export function connectionRequirements(
  kit: Pick<StarterKitView, "connections">,
): StarterKitConnectionRequirement[] {
  return kit.connections.filter((r) => !isProviderRequirement(r));
}

function familiesIn(
  templates: TemplateIndex,
): Map<string, { id: string; title: string }> {
  const out = new Map<string, { id: string; title: string }>();
  for (const t of templates.values())
    if (t.family && !out.has(t.family.id)) out.set(t.family.id, t.family);
  return out;
}

export function describeAccepts(
  ids: readonly string[],
  templates: TemplateIndex,
): string {
  const families = familiesIn(templates);
  return ids
    .map(
      (id) =>
        families.get(id)?.title ??
        templates.get(id)?.name ??
        id.charAt(0).toUpperCase() + id.slice(1),
    )
    .join(" or ");
}

export function kitScheduleCadence(schedule: StarterKitSchedule): string {
  if ("rrule" in schedule)
    return `${rruleToText(schedule.rrule)} (${schedule.timezone})`;
  return `${cronToText(schedule.cron)} (${CRON_TIMEZONE})`;
}

export function withOverride(
  overrides: readonly StarterKitScheduleOverride[],
  name: string,
  override: Omit<StarterKitScheduleOverride, "name">,
): StarterKitScheduleOverride[] {
  const next = { name, ...override };
  return overrides.some((o) => o.name === name)
    ? overrides.map((o) => (o.name === name ? next : o))
    : [...overrides, next];
}

export function accepts(
  requirement: { accepts: readonly string[] },
  connection: { templateId: string },
  templates: TemplateIndex,
): boolean {
  return requirementAccepts(
    requirement,
    connection.templateId,
    templates.get(connection.templateId)?.family?.id,
  );
}

export function toggleSkipped(
  skipped: readonly string[],
  name: string,
): string[] {
  return skipped.includes(name)
    ? skipped.filter((n) => n !== name)
    : [...skipped, name];
}
