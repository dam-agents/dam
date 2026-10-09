import { PROVIDERS, providerTypeForTemplateId } from "api-server-api";

import type { AgentView, TemplateView } from "../../../types.js";
import {
  formatSizeLabel,
  sizeInMi,
  type SlotUnit,
} from "../../budgets/lib/slots.js";
import { findTemplate } from "../../templates/lib/find-template.js";

export interface SandboxSubtitleLookup {
  templates: readonly TemplateView[];
  connectionTemplateIdById: ReadonlyMap<string, string>;
  slotUnit: SlotUnit | null;
}

export function sandboxSubtitleParts(
  agent: AgentView,
  lookup: SandboxSubtitleLookup,
): { harness: string; provider: string | null } {
  const harness =
    findTemplate(lookup.templates, agent.templateId)?.name ?? agent.image;
  return { harness, provider: providerLabel(agent, lookup) };
}

function joinSubtitleSegments(
  segments: ReadonlyArray<string | null | undefined>,
): string {
  return segments.filter(Boolean).join(" · ");
}

export function sandboxSubtitle(
  agent: AgentView,
  lookup: SandboxSubtitleLookup,
): string {
  const { harness, provider } = sandboxSubtitleParts(agent, lookup);
  return joinSubtitleSegments([harness, provider, sizeLabel(agent, lookup)]);
}

function sizeLabel(
  agent: AgentView,
  lookup: SandboxSubtitleLookup,
): string | null {
  if (!lookup.slotUnit || !agent.size.cpu || !agent.size.memory) return null;
  return formatSizeLabel(sizeInMi(agent.size), lookup.slotUnit);
}

function providerLabel(
  agent: AgentView,
  lookup: SandboxSubtitleLookup,
): string | null {
  for (const connectionId of agent.grantedConnectionIds) {
    const templateId = lookup.connectionTemplateIdById.get(connectionId);
    const preset = templateId ? providerTypeForTemplateId(templateId) : null;
    if (preset) return PROVIDERS[preset].displayName;
  }
  return null;
}
