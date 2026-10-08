export type ProviderKeyProbeOutcome =
  | { ok: true }
  | { ok: false; reason: "refused" | "unverified"; detail: string };

export interface ProviderKeyProbe {
  probe(templateId: string, key: string): Promise<ProviderKeyProbeOutcome>;
}
