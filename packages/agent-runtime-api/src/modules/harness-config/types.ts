import type { z } from "zod";
import type {
  HarnessConfigChoice,
  HarnessConfigCurrent,
} from "../runtime/types.js";
import type { harnessConfigNoticeSchema } from "./schemas.js";

export type HarnessConfigNotice = z.infer<typeof harnessConfigNoticeSchema>;

export interface CatalogModelPrices {
  inputPerToken: number;
  outputPerToken: number;
  cacheReadPerToken: number | null;
  cacheWritePerToken: number | null;
}

export type CatalogMetadataSource = "provider" | "table" | "preset" | "none";

export interface CatalogModelView {
  name: string;
  upstreamId: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  reasoning: boolean | null;
  vision: boolean | null;
  prices: CatalogModelPrices | null;
  source: { limits: CatalogMetadataSource; prices: CatalogMetadataSource };
}

export type CatalogProviderStatus = "listed" | "unavailable" | "unsupported";

export interface CatalogProviderView {
  connectionId: string;
  alias: string;
  template: string;
  displayName: string;
  status: CatalogProviderStatus;
  listedAt: string | null;
  models: CatalogModelView[];
}

export interface HarnessCatalogView {
  harness: string;
  routed: boolean;
  providers: CatalogProviderView[];
}

export interface HarnessConfigService {
  readCurrent: (opts?: { harness?: string }) => Promise<HarnessConfigCurrent>;
  models: (lease: {
    harness: string;
    provider: string | null;
  }) => Promise<HarnessConfigChoice[] | null | undefined>;
  watch(signal?: AbortSignal): AsyncIterable<HarnessConfigNotice>;
  catalog: (input: { harness: string }) => Promise<HarnessCatalogView>;
}
