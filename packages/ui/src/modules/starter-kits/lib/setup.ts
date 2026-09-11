import {
  type ConnectionTemplateView,
  PROVIDER_TEMPLATE_IDS,
  type ProviderPresetType,
  type StarterKitApplyInput,
  type StarterKitConnectionRequirement,
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
}

export interface GrantedConnection {
  id: string;
  templateId: string;
}

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

export function requirementStatuses(
  kit: Pick<StarterKitView, "connections">,
  draft: StarterKitSetupDraft,
  owned: readonly GrantedConnection[],
): RequirementStatus[] {
  const granted = new Set(draftConnectionIds(draft));
  const templates = new Set(
    owned.filter((c) => granted.has(c.id)).map((c) => c.templateId),
  );
  return kit.connections.map((requirement) => ({
    requirement,
    satisfied: requirement.templates.some((t) => templates.has(t)),
  }));
}

export function isStarterKitSetupComplete(
  kit: Pick<StarterKitView, "template" | "connections">,
  draft: StarterKitSetupDraft,
  owned: readonly GrantedConnection[],
): boolean {
  if (draft.name.trim().length === 0) return false;
  if (!kit.template && draft.templateId === null) return false;
  if (draft.providerRef === null) return false;
  return requirementStatuses(kit, draft, owned).every(
    (s) => s.satisfied || !s.requirement.required,
  );
}

export function buildStarterKitApplyInput(
  kit: Pick<StarterKitView, "id" | "template" | "connections">,
  draft: StarterKitSetupDraft,
  owned: readonly GrantedConnection[],
): StarterKitApplyInput {
  if (!isStarterKitSetupComplete(kit, draft, owned)) {
    throw new Error(
      "cannot build starter kit apply input from an incomplete draft",
    );
  }
  const slackChannelId = draft.slackChannelId.trim();
  return {
    kitId: kit.id,
    name: draft.name.trim(),
    connectionIds: draftConnectionIds(draft),
    ...(kit.template ? {} : { templateId: draft.templateId ?? undefined }),
    ...(slackChannelId ? { slackChannelId } : {}),
  };
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
  return requirement.templates.some(isProviderTemplate);
}

export function providerPolicyForKit(
  kit: Pick<StarterKitView, "connections">,
  base: SetupProviderPolicy,
): SetupProviderPolicy {
  const providerReq = kit.connections.find(isProviderRequirement);
  if (!providerReq) return base;
  const allow = providerReq.templates.filter(isProviderTemplate);
  const recommended =
    base.recommended && allow.includes(base.recommended)
      ? base.recommended
      : allow[0];
  return { allow, recommended };
}

export function connectableTemplates(
  requirement: StarterKitConnectionRequirement,
  templateById: ReadonlyMap<string, ConnectionTemplateView>,
): ConnectionTemplateView[] {
  return requirement.templates.flatMap((id) => {
    const t = templateById.get(id);
    return t ? [t] : [];
  });
}

export function describeTemplates(
  ids: readonly string[],
  templateById: ReadonlyMap<string, Pick<ConnectionTemplateView, "name">>,
): string {
  return ids.map((id) => templateById.get(id)?.name ?? id).join(" or ");
}
