import {
  type ConnectionTemplateView,
  type HarnessFamily,
  PROVIDER_TEMPLATE_IDS,
  type ProviderPresetType,
  rruleToText,
  type StarterKitApplyInput,
  type StarterKitConnectionRequirement,
  type StarterKitSchedule,
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
  kit: Pick<StarterKitView, "id" | "image" | "connections">,
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
    kitId: kit.id,
    name: draft.name.trim(),
    connectionIds: draftConnectionIds(draft),
    ...(kit.image ? {} : { templateId: draft.templateId ?? undefined }),
    ...(slackChannelId ? { slackChannelId } : {}),
    skipSchedules: draft.skippedSchedules,
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
  kit: Pick<StarterKitView, "connections">,
  base: SetupProviderPolicy,
): SetupProviderPolicy {
  const providerReq = kit.connections.find(isProviderRequirement);
  if (!providerReq) return base;
  const allow = providerReq.accepts.filter(isProviderTemplate);
  const recommended =
    base.recommended && allow.includes(base.recommended)
      ? base.recommended
      : allow[0];
  return { allow, recommended };
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
