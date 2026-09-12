import { PROVIDERS, providerTypeForTemplateId } from "api-server-api";

import type { AgentView } from "../../../types.js";
import { kbTemplateName } from "../../knowledge-bases/lib/kb-templates.js";

export interface SandboxSubtitleLookup {
  templateNameById: ReadonlyMap<string, string>;
  connectionTemplateIdById: ReadonlyMap<string, string>;
}

export function sandboxSubtitleParts(
  agent: AgentView,
  lookup: SandboxSubtitleLookup,
): { harness: string; provider: string | null } {
  const harness =
    (agent.templateId
      ? lookup.templateNameById.get(agent.templateId)
      : undefined) ?? agent.image;
  return { harness, provider: providerLabel(agent, lookup) };
}

export function joinSubtitleSegments(
  segments: ReadonlyArray<string | null | undefined>,
): string {
  return segments.filter(Boolean).join(" · ");
}

export function sandboxSubtitle(
  agent: AgentView,
  lookup: SandboxSubtitleLookup,
  extras?: {
    experimentCount?: number;
  },
): string {
  if (agent.kind === "experiment") {
    const kinded = joinSubtitleSegments([
      experimentCountLabel(extras?.experimentCount),
      catalogConnectionsLabel(agent, lookup),
    ]);
    return kinded || sandboxSubtitleParts(agent, lookup).harness;
  }
  if (agent.kind === "knowledge-base") {
    const kinded = joinSubtitleSegments([
      kbTemplateName(agent.kbTemplateId),
      catalogConnectionsLabel(agent, lookup),
    ]);
    return kinded || sandboxSubtitleParts(agent, lookup).harness;
  }
  const { harness, provider } = sandboxSubtitleParts(agent, lookup);
  return joinSubtitleSegments([harness, provider]);
}

function experimentCountLabel(count: number | undefined): string | null {
  if (count === undefined) return null;
  if (count === 0) return "No active experiments";
  return `${count} experiment${count === 1 ? "" : "s"}`;
}

function catalogConnectionsLabel(
  agent: AgentView,
  lookup: SandboxSubtitleLookup,
): string | null {
  let count = 0;
  for (const connectionId of agent.grantedConnectionIds) {
    const templateId = lookup.connectionTemplateIdById.get(connectionId);
    if (templateId && providerTypeForTemplateId(templateId)) continue;
    count += 1;
  }
  if (count === 0) return null;
  return `${count} connection${count === 1 ? "" : "s"}`;
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
