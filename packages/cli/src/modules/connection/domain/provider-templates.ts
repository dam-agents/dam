// Mirrors packages/ui/src/modules/connections/lib/provider-templates.ts.
export type CliProviderType = "anthropic" | "ibm-litellm" | "openai";

const PROVIDER_TEMPLATE_TO_TYPE: ReadonlyMap<string, CliProviderType> = new Map(
  [
    ["anthropic", "anthropic"],
    ["anthropic-oauth", "anthropic"],
    ["openai", "openai"],
    ["ibm-litellm", "ibm-litellm"],
  ],
);

export const PROVIDER_TEMPLATE_IDS: ReadonlySet<string> = new Set(
  PROVIDER_TEMPLATE_TO_TYPE.keys(),
);

export const GITHUB_PAT_TEMPLATE_ID = "github-pat";

export function providerTypeForTemplateId(
  templateId: string,
): CliProviderType | null {
  return PROVIDER_TEMPLATE_TO_TYPE.get(templateId) ?? null;
}

export function templateIdForProvider(
  type: CliProviderType,
  value: string,
): string {
  if (type === "anthropic") {
    // `sk-ant-oat…` tokens inject as `Authorization: Bearer`; plain keys as `x-api-key`.
    return value.startsWith("sk-ant-oat") ? "anthropic-oauth" : "anthropic";
  }
  return type;
}
