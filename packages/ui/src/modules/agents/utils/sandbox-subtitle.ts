import { PROVIDERS, providerTypeForTemplateId } from "api-server-api";

import type { AgentView } from "../../../types.js";

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

/** "harness · provider" row subtitle; the provider segment is omitted when no
 *  granted connection resolves to a provider. */
export function sandboxSubtitle(
  agent: AgentView,
  lookup: SandboxSubtitleLookup,
): string {
  const { harness, provider } = sandboxSubtitleParts(agent, lookup);
  return provider ? `${harness} · ${provider}` : harness;
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
