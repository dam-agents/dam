import type { AgentView, TemplateView } from "../../../types.js";
import {
  formatSizeLabel,
  sizeInMi,
  type SlotUnit,
} from "../../budgets/lib/slots.js";
import { findTemplate } from "../../templates/lib/find-template.js";

export interface SandboxSubtitleLookup {
  templates: readonly TemplateView[];
  slotUnit: SlotUnit | null;
}

export function sandboxSubtitleParts(
  agent: AgentView,
  lookup: SandboxSubtitleLookup,
): { harness: string } {
  return {
    harness:
      findTemplate(lookup.templates, agent.templateId)?.name ?? agent.image,
  };
}

export function sandboxSubtitle(
  agent: AgentView,
  lookup: SandboxSubtitleLookup,
): string | null {
  if (agent.vm || !lookup.slotUnit || !agent.size.cpu || !agent.size.memory)
    return null;
  return formatSizeLabel(sizeInMi(agent.size), lookup.slotUnit);
}
