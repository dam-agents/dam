export interface PriceTableEntry {
  key: string;
  mode?: string;
  max_input_tokens?: number;
  max_output_tokens?: number;
  max_tokens?: number;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  supports_vision?: boolean;
  supports_reasoning?: boolean;
}

export interface PriceTable {
  source: { url: string; commit: string; fetchedAt: string };
  models: Record<string, PriceTableEntry>;
}

export function normalizeModelKey(id: string): string {
  const segments = id.split("/");
  return (segments[segments.length - 1] ?? id)
    .toLowerCase()
    .replace(/\./g, "-");
}

const BEDROCK_PROFILE =
  /^(?:[a-z]{2}(?:-gov)?\.)?(?:anthropic|meta|amazon|mistral|cohere|ai21)\.(.+?)(?:-v\d+(?::\d+)?)?$/;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the table is keyed by family name while
 * providers prefix ids with a deployment and Bedrock profiles wrap them, so
 * the lookup tries the id, its last path segment, then the profile's inner
 * name, each normalised as the vendoring task normalised the keys.
 */
export function lookupPrice(
  table: PriceTable,
  upstreamId: string,
): PriceTableEntry | null {
  const segments = upstreamId.split("/");
  const candidates = [
    upstreamId,
    segments[segments.length - 1] ?? upstreamId,
  ];
  const profile = BEDROCK_PROFILE.exec(candidates[1]!);
  if (profile?.[1]) candidates.push(profile[1]);
  for (const candidate of candidates) {
    const hit = table.models[normalizeModelKey(candidate)];
    if (hit) return hit;
  }
  return null;
}
