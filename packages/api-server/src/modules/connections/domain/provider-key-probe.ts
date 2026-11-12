import { CLOUD_GATEWAY_ENDPOINT_ENV, type Contribution } from "api-server-api";

export type ProviderKeyProbeOutcome =
  | { ok: true; unchecked?: true; account?: string }
  | { ok: false; reason: "refused" | "unverified"; detail: string };

export interface ProviderKeyTarget {
  region?: string;
  endpoint?: string;
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
  const env = (name: string): string | undefined => {
    const found = contributions.find(
      (c) => c.kind === "env" && c.name === name,
    );
    return found?.kind === "env" ? found.placeholder : undefined;
  };
  const region = env(REGION_ENV);
  const endpoint = env(CLOUD_GATEWAY_ENDPOINT_ENV);
  return {
    ...(region ? { region } : {}),
    ...(endpoint ? { endpoint } : {}),
  };
}
