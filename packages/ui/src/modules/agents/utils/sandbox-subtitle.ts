import type { SecretType } from "api-server-api";
import {
  isProviderPresetType,
  PROVIDERS,
  providerTypeForTemplateId,
} from "api-server-api";

import type { AgentView } from "../../../types.js";

export interface SandboxSubtitleLookup {
  templateNameById: ReadonlyMap<string, string>;
  connectionTemplateIdById: ReadonlyMap<string, string>;
  secretTypeById: ReadonlyMap<string, SecretType>;
}

/** "harness · provider" row subtitle. The harness segment degrades to the raw
 *  image ref when the template is unknown; the provider segment is omitted
 *  when no granted connection/secret resolves to a provider. */
export function sandboxSubtitle(
  agent: AgentView,
  lookup: SandboxSubtitleLookup,
): string {
  const harness =
    (agent.templateId
      ? lookup.templateNameById.get(agent.templateId)
      : undefined) ?? agent.image;
  const provider = providerLabel(agent, lookup);
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
  // Secrets fallback for pre-Connections provider grants — delete after the
  // #601 cutover.
  for (const secretId of agent.grantedSecretIds) {
    const type = lookup.secretTypeById.get(secretId);
    if (type && isProviderPresetType(type)) return PROVIDERS[type].displayName;
  }
  return null;
}
