import type { Contribution } from "api-server-api";

export type ProviderKeyProbeOutcome =
  | { ok: true; unchecked?: true }
  | { ok: false; reason: "refused" | "unverified"; detail: string };

export interface ProviderKeyTarget {
  region?: string;
}

export interface ProviderKeyProbe {
  probe(
    templateId: string,
    key: string,
    target?: ProviderKeyTarget,
  ): Promise<ProviderKeyProbeOutcome>;
}

const REGION_ENV = "AWS_REGION";

export function providerKeyTargetOf(
  contributions: readonly Contribution[],
): ProviderKeyTarget {
  const region = contributions.find(
    (c) => c.kind === "env" && c.name === REGION_ENV,
  );
  return region?.kind === "env" ? { region: region.placeholder } : {};
}
