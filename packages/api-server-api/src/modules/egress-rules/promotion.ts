export function needsL7Promotion(
  method: string,
  pathPattern: string,
  port?: number,
): boolean {
  return method !== "*" || pathPattern !== "*" || port != null;
}

export interface PromotionRule {
  host: string;
  method: string;
  pathPattern: string;
  port?: number;
  source: string;
}

export function promotedHosts(rules: readonly PromotionRule[]): string[] {
  const hosts = rules
    .filter((r) => r.host !== "*")
    .filter((r) => !r.source.startsWith("connection:"))
    .filter((r) => needsL7Promotion(r.method, r.pathPattern, r.port))
    .map((r) => r.host);
  return [...new Set(hosts)].sort();
}

export interface GatewayRestartImpact {
  promoted: string[];
  demoted: string[];
  willRestart: boolean;
}

export interface GatewayRestartImpactInput {
  current: readonly (PromotionRule & { id: string })[];
  adds?: readonly PromotionRule[];
  removeIds?: readonly string[];
}

export function gatewayRestartImpact(
  input: GatewayRestartImpactInput,
): GatewayRestartImpact {
  const removed = new Set(input.removeIds ?? []);
  const before = promotedHosts(input.current);
  const after = promotedHosts([
    ...input.current.filter((r) => !removed.has(r.id)),
    ...(input.adds ?? []),
  ]);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const promoted = after.filter((h) => !beforeSet.has(h));
  const demoted = before.filter((h) => !afterSet.has(h));
  return {
    promoted,
    demoted,
    willRestart: promoted.length > 0 || demoted.length > 0,
  };
}
