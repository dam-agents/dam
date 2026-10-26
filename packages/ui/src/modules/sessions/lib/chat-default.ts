import {
  aliasForProviderType,
  parseQualifiedModel,
  providerTypeForTemplateId,
  type SessionPair,
} from "api-server-api";

export interface ChatDefaultSources {
  harness: string | null | undefined;
  model: string | null | undefined;
  grantedConnectionIds: readonly string[];
  connections: readonly { id: string; templateId: string }[];
}

export function chatDefaultFor(
  sources: ChatDefaultSources,
): SessionPair | null {
  const harness = sources.harness?.trim();
  const model = sources.model?.trim();
  if (!harness || !model) return null;
  const parsed = parseQualifiedModel(model, { claudePrefix: true });
  if (!parsed) return null;
  const provider = sources.connections.find((connection) => {
    if (!sources.grantedConnectionIds.includes(connection.id)) return false;
    const connectionType = providerTypeForTemplateId(connection.templateId);
    return (
      connectionType !== null &&
      aliasForProviderType(connectionType) === parsed.alias
    );
  });
  if (!provider) return null;
  return { harness, provider: provider.id, model };
}
