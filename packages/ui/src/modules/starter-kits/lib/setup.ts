import {
  type ConnectionTemplateView,
  type HarnessFamily,
  PROVIDER_TEMPLATE_IDS,
  type ProviderPresetType,
  rruleToText,
  type StarterKitApplyInput,
  type StarterKitConnectionRequirement,
  type StarterKitSchedule,
  type StarterKitScheduleOverride,
  type StarterKitView,
} from "api-server-api";

import type { ProviderRef } from "../../providers/components/provider-item.js";
import type { SetupProviderPolicy } from "../../sandboxes/lib/setup-policy.js";

export interface StarterKitSetupDraft {
  name: string;
  templateId: string | null;
  providerRef: ProviderRef | null;
  connectionIds: string[];
  slackChannelId: string;
  skippedSchedules: string[];
  scheduleOverrides: StarterKitScheduleOverride[];
}

export interface GrantedConnection {
  id: string;
  templateId: string;
  name?: string;
}

export type TemplateIndex = ReadonlyMap<
  string,
  Pick<ConnectionTemplateView, "id" | "name" | "family">
>;

export interface RequirementStatus {
  requirement: StarterKitConnectionRequirement;
  satisfied: boolean;
}

export function draftConnectionIds(draft: StarterKitSetupDraft): string[] {
  return [
    ...new Set([
      ...draft.connectionIds,
      ...(draft.providerRef ? [draft.providerRef.id] : []),
    ]),
  ];
}

function acceptsTemplate(
  requirement: StarterKitConnectionRequirement,
  templateId: string,
  templates: TemplateIndex,
): boolean {
  if (requirement.accepts.includes(templateId)) return true;
  const family = templates.get(templateId)?.family;
  return family !== undefined && requirement.accepts.includes(family.id);
}

export function ownedMatches(
  requirement: StarterKitConnectionRequirement,
  owned: readonly GrantedConnection[],
  templates: TemplateIndex,
): GrantedConnection[] {
  return owned.filter((c) =>
    acceptsTemplate(requirement, c.templateId, templates),
  );
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
  kit: Pick<StarterKitView, "image" | "connections">,
  draft: StarterKitSetupDraft,
  owned: readonly GrantedConnection[],
  templates: TemplateIndex,
): boolean {
  if (draft.name.trim().length === 0) return false;
  if (!kit.image && draft.templateId === null) return false;
  if (draft.providerRef === null) return false;
  return requirementStatuses(kit, draft, owned, templates).every(
    (s) => s.satisfied || !s.requirement.required,
  );
}

export function buildStarterKitApplyInput(
  kit: Pick<StarterKitView, "id" | "catalog" | "image" | "connections">,
  draft: StarterKitSetupDraft,
  owned: readonly GrantedConnection[],
  templates: TemplateIndex,
): StarterKitApplyInput {
  if (!isStarterKitSetupComplete(kit, draft, owned, templates)) {
    throw new Error(
      "cannot build starter kit apply input from an incomplete draft",
    );
  }
  const slackChannelId = draft.slackChannelId.trim();
  return {
    catalog: kit.catalog,
    kitId: kit.id,
    name: draft.name.trim(),
    connectionIds: draftConnectionIds(draft),
    ...(kit.image ? {} : { templateId: draft.templateId ?? undefined }),
    ...(slackChannelId ? { slackChannelId } : {}),
    skipSchedules: draft.skippedSchedules,
    scheduleOverrides: draft.scheduleOverrides.filter(
      (o) => !draft.skippedSchedules.includes(o.name),
    ),
  };
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
  return FULL_SHA.test(version) ? version.slice(0, 7) : version;
}

function isProviderTemplate(id: string): id is ProviderPresetType {
  return PROVIDER_TEMPLATE_IDS.has(id);
}

export function isProviderRequirement(
  requirement: StarterKitConnectionRequirement,
): boolean {
  return requirement.accepts.some(isProviderTemplate);
}

export function providerPolicyForKit(
  kit: Pick<StarterKitView, "connections" | "providers">,
  base: SetupProviderPolicy,
): SetupProviderPolicy {
  const declared =
    kit.providers ??
    kit.connections
      .find(isProviderRequirement)
      ?.accepts.filter(isProviderTemplate);
  if (!declared || declared.length === 0) return base;
  const recommended =
    base.recommended && declared.includes(base.recommended)
      ? base.recommended
      : declared[0];
  return { allow: declared, recommended };
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

export interface ConnectTarget {
  key: string;
  label: string;
  providerId: string;
  templateId?: string;
}

export function connectTargets(
  requirement: StarterKitConnectionRequirement,
  templates: TemplateIndex,
): ConnectTarget[] {
  const families = familiesIn(templates);
  const out: ConnectTarget[] = [];
  const seen = new Set<string>();
  for (const id of requirement.accepts) {
    const family = families.get(id);
    if (family) {
      if (seen.has(family.id)) continue;
      seen.add(family.id);
      out.push({ key: family.id, label: family.title, providerId: family.id });
      continue;
    }
    const template = templates.get(id);
    if (!template || seen.has(id)) continue;
    seen.add(id);
    out.push({
      key: id,
      label: template.name,
      providerId: template.family?.id ?? id,
      templateId: id,
    });
  }
  return out;
}

export function describeAccepts(
  ids: readonly string[],
  templates: TemplateIndex,
): string {
  const families = familiesIn(templates);
  return ids
    .map((id) => families.get(id)?.title ?? templates.get(id)?.name ?? id)
    .join(" or ");
}

export function kitScheduleCadence(schedule: StarterKitSchedule): string {
  if ("rrule" in schedule)
    return `${rruleToText(schedule.rrule)} (${schedule.timezone})`;
  return schedule.cron;
}

export function effectiveTiming(
  schedule: StarterKitSchedule,
  override: StarterKitScheduleOverride | undefined,
): { cron: string } | { rrule: string; timezone: string } {
  if (override?.timing) return override.timing;
  return "cron" in schedule
    ? { cron: schedule.cron }
    : { rrule: schedule.rrule, timezone: schedule.timezone };
}

export function describeTiming(
  timing: { cron: string } | { rrule: string; timezone: string },
): string {
  return "cron" in timing
    ? timing.cron
    : `${rruleToText(timing.rrule)} (${timing.timezone})`;
}

export function withOverride(
  overrides: readonly StarterKitScheduleOverride[],
  name: string,
  patch: Omit<StarterKitScheduleOverride, "name">,
): StarterKitScheduleOverride[] {
  const existing = overrides.find((o) => o.name === name);
  const next = { ...existing, name, ...patch };
  return existing
    ? overrides.map((o) => (o.name === name ? next : o))
    : [...overrides, next];
}

export function accepts(
  requirement: { accepts: readonly string[] },
  connection: { templateId: string },
  templates: TemplateIndex,
): boolean {
  const familyId = templates.get(connection.templateId)?.family?.id;
  return (
    requirement.accepts.includes(connection.templateId) ||
    (familyId !== undefined && requirement.accepts.includes(familyId))
  );
}

export type RequirementChoiceMode = "connect" | "use" | "pick" | "chosen";

export interface RequirementChoice<G> {
  mode: RequirementChoiceMode;
  chosen: G[];
  candidates: GrantedConnection[];
  switchTo: GrantedConnection[];
}

export function requirementChoice<G extends { id: string; templateId: string }>(
  requirement: StarterKitConnectionRequirement,
  owned: readonly GrantedConnection[],
  granted: readonly G[],
  templates: TemplateIndex,
): RequirementChoice<G> {
  const chosen = granted.filter((c) => accepts(requirement, c, templates));
  const candidates = ownedMatches(requirement, owned, templates);
  const unchosen = candidates.filter((c) => !chosen.some((g) => g.id === c.id));
  const mode: RequirementChoiceMode =
    chosen.length > 0
      ? "chosen"
      : candidates.length === 0
        ? "connect"
        : candidates.length === 1
          ? "use"
          : "pick";
  return {
    mode,
    chosen,
    candidates,
    switchTo: chosen.length === 1 ? unchosen : [],
  };
}

export function kitConnectionIds(
  kit: Pick<StarterKitView, "connections">,
  granted: readonly { id: string; templateId: string }[],
  templates: TemplateIndex,
): Set<string> {
  return new Set(
    granted
      .filter((c) => kit.connections.some((r) => accepts(r, c, templates)))
      .map((c) => c.id),
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

const HARNESS_LABEL: Record<HarnessFamily, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  pi: "Pi",
  bob: "Bob",
};

export function harnessFamilyLabel(
  harness: HarnessFamily | undefined,
): string | undefined {
  return harness ? HARNESS_LABEL[harness] : undefined;
}

export function ownAgentLine(
  kit: Pick<StarterKitView, "image">,
): string | undefined {
  if (!kit.image) return undefined;
  const on = harnessFamilyLabel(kit.image.harness);
  return on ? `Its own agent, built on ${on}` : "Its own agent";
}

export function kitResourcesLine(
  kit: Pick<StarterKitView, "resources">,
): string | undefined {
  const r = kit.resources;
  if (!r) return undefined;
  const parts = [
    r.cpu ? `${r.cpu} CPU` : undefined,
    r.memory ? `${r.memory} memory` : undefined,
    r.storage ? `${r.storage} disk` : undefined,
  ].filter((p): p is string => p !== undefined);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function allowedHarnesses<T extends { harness?: HarnessFamily }>(
  kit: Pick<StarterKitView, "harnesses">,
  harnesses: readonly T[],
): T[] {
  if (!kit.harnesses) return [...harnesses];
  return harnesses.filter(
    (t) => t.harness !== undefined && kit.harnesses!.includes(t.harness),
  );
}

export function harnessesLine(
  kit: Pick<StarterKitView, "image" | "harnesses" | "knowledgeBase">,
): string {
  if (kit.knowledgeBase)
    return `A knowledge base agent on ${
      kit.harnesses
        ? kit.harnesses.map((h) => harnessFamilyLabel(h) ?? h).join(" or ")
        : "the harness you pick"
    }`;
  const own = ownAgentLine(kit);
  if (own) return own;
  if (!kit.harnesses) return "An agent on the harness you pick";
  return `An agent on ${kit.harnesses
    .map((h) => harnessFamilyLabel(h) ?? h)
    .join(" or ")}`;
}
