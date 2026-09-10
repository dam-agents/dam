import type {
  StarterKitApplyInput,
  StarterKitConnectionRequirement,
  StarterKitView,
} from "api-server-api";

import type { ProviderRef } from "../../providers/components/provider-item.js";

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
