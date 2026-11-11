import {
  aliasForTemplateId,
  HARNESS_HOME_PROVIDERS,
  parseQualifiedModel,
} from "api-server-api";

/** UNIT_BOUNDARY_DESCRIPTION: an explicitly qualified model selects its native Connection; only the harness's home provider can supply an implicit native default, so a separate subscription alias cannot replace API routing. */
export function selectNativeConnection(input: {
  harness: string;
  model: string | null;
  templates: readonly string[] | undefined;
  providers: readonly { id: string; template?: string }[];
}): string | null {
  const alias = input.model
    ? parseQualifiedModel(input.model)?.alias
    : HARNESS_HOME_PROVIDERS[input.harness]?.[0];
  const templates = input.templates;
  if (!alias || !templates) return null;
  return (
    input.providers.find(
      (provider) =>
        provider.template !== undefined &&
        templates.includes(provider.template) &&
        aliasForTemplateId(provider.template) === alias,
    )?.id ?? null
  );
}
