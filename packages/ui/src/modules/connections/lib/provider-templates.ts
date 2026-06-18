import type { ProviderPresetType } from "api-server-api";
import { PROVIDER_PRESET_TYPES, PROVIDERS } from "api-server-api";

const PRESET_BY_TEMPLATE_ID: ReadonlyMap<string, ProviderPresetType> = new Map([
  ...PROVIDER_PRESET_TYPES.map((id): [string, ProviderPresetType] => [id, id]),
  ["anthropic-oauth", "anthropic"],
]);

// Provider templates managed by the legacy Providers view; `anthropic-oauth`
// rides the same card as the API-key variant.
export const PROVIDER_TEMPLATE_IDS: ReadonlySet<string> = new Set(
  PRESET_BY_TEMPLATE_ID.keys(),
);

export function providerTemplateDisplayName(templateId: string): string | null {
  const presetId = PRESET_BY_TEMPLATE_ID.get(templateId);
  return presetId ? PROVIDERS[presetId].displayName : null;
}

export function providerPresetForTemplateId(
  templateId: string,
): ProviderPresetType | null {
  return PRESET_BY_TEMPLATE_ID.get(templateId) ?? null;
}
