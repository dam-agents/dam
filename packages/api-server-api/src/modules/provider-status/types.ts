export type ProviderOutageReason =
  "failing-calls" | "unreachable" | "provider-reported";

export interface ProviderOutage {
  templateId: string;
  reason: ProviderOutageReason;
  since: string;
  statusPageUrl: string | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Provider Status of every model provider,
 * per Connection template. A template that is not in `outages` is healthy or
 * unknown. `damSide` is set when every provider with calls fails, so the
 * cause is on the platform's side; then only the outages that a public source
 * reports stay listed. `checkedAt` is null when no evaluation has run in the
 * last three minutes.
 */
export interface ProviderStatusView {
  damSide: { since: string } | null;
  outages: ProviderOutage[];
  checkedAt: string | null;
}

export interface ProviderStatusService {
  view(): Promise<ProviderStatusView>;
}
