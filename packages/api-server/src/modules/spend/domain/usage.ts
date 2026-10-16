/**
 * UNIT_BOUNDARY_DESCRIPTION: The token counts of one model call, the same for
 * every API dialect, as the cost formula reads them. Input tokens are only the
 * uncached ones: OpenAI counts its cached tokens inside the prompt tokens, so
 * they are taken out before they land here; Anthropic counts them apart.
 */
export interface NormalizedUsage {
  readonly uncachedInputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWrite5mTokens: number;
  readonly cacheWrite1hTokens: number;
  readonly cacheWriteUnsplitTokens: number;
  readonly webSearches: number;
  readonly bobCredits: number | null;
  readonly serviceTier: string | null;
  readonly speed: string | null;
  readonly inferenceGeo: string | null;
}

export function promptTokens(usage: NormalizedUsage): number {
  return (
    usage.uncachedInputTokens +
    usage.cacheReadTokens +
    usage.cacheWrite5mTokens +
    usage.cacheWrite1hTokens +
    usage.cacheWriteUnsplitTokens
  );
}
