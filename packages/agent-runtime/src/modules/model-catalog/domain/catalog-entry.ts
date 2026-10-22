import type { ProviderAlias } from "api-server-api";
import type { ModelDialect } from "../../runtime-channel/manifest.js";

export type { ModelDialect };

export interface ModelPrices {
  inputPerToken: number;
  outputPerToken: number;
  cacheReadPerToken: number | null;
  cacheWritePerToken: number | null;
}

export type MetadataSource = "provider" | "table" | "known" | "preset" | "none";

export interface ModelMetadata {
  contextWindow: number | null;
  maxOutputTokens: number | null;
  reasoning: boolean | null;
  vision: boolean | null;
  cacheControl: "anthropic" | null;
  thinkingFormat: "zai" | null;
  prices: ModelPrices | null;
  source: { limits: MetadataSource; prices: MetadataSource };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: `harnesses`, when set, names the only harnesses
 * the entry is offered to and routed for (Anthropic accepts a subscription
 * token from Claude Code alone); unset means every harness that speaks one
 * of the dialects.
 */
export interface CatalogEntry {
  name: string;
  alias: ProviderAlias;
  connectionId: string;
  template: string;
  upstreamId: string;
  dialects: readonly ModelDialect[];
  harnesses?: readonly string[];
  metadata: ModelMetadata;
}

export type ProviderListingStatus = "listed" | "unavailable" | "unsupported";

export interface CatalogProvider {
  connectionId: string;
  alias: ProviderAlias;
  template: string;
  displayName: string;
  dialects: readonly ModelDialect[];
  harnesses?: readonly string[];
  status: ProviderListingStatus;
  listedAt: string | null;
  entries: CatalogEntry[];
}
