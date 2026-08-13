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
