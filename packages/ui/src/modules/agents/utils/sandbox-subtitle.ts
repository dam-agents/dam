import { PROVIDERS, providerTypeForTemplateId } from "api-server-api";

import type { AgentView } from "../../../types.js";
import { kbTemplateName } from "../../knowledge-bases/lib/kb-templates.js";

export interface SandboxSubtitleLookup {
  templateNameById: ReadonlyMap<string, string>;
  connectionTemplateIdById: ReadonlyMap<string, string>;
}

/** The harness + provider segments of a sandbox subtitle. The harness segment
 *  degrades to the raw image ref when the template is unknown; the provider
 *  segment is null when no granted connection resolves to a provider. */
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

/** The one way row-subtitle segments are joined — surfaces that prepend their
 *  own segment use this too, so the separator and empty-segment omission
 *  can't drift. */
export function joinSubtitleSegments(
  segments: ReadonlyArray<string | null | undefined>,
): string {
  return segments.filter(Boolean).join(" · ");
}

/** Row subtitle, shaped by the agent's Kind (#3001): a kinded sandbox leads
 *  with what it is FOR, not the image it runs on.
 *
 *  - experiment:      "N experiments · M connections" ("No active experiments"
 *                     while it has none — the state a fresh sandbox sits in)
 *  - knowledge-base:  "Template · M connections"
 *  - plain:           "harness · provider"
 *
 *  The connections segment counts catalog connections only (a provider
 *  credential is the provider segment's business) and is omitted at zero. */
export function sandboxSubtitle(
  agent: AgentView,
  lookup: SandboxSubtitleLookup,
  extras?: {
    /** Named experiments this sandbox drives; undefined while still loading. */
    experimentCount?: number;
  },
): string {
  if (agent.kind === "experiment") {
    return joinSubtitleSegments([
      experimentCountLabel(extras?.experimentCount),
      catalogConnectionsLabel(agent, lookup),
    ]);
  }
  if (agent.kind === "knowledge-base") {
    return joinSubtitleSegments([
      kbTemplateName(agent.kbTemplateId),
      catalogConnectionsLabel(agent, lookup),
    ]);
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
