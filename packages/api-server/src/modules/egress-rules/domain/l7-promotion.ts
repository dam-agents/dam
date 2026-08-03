/**
 * Whether a rule needs its host promoted onto Envoy's L7 (MITM) chain to be
 * enforceable over HTTPS. The L4 catch-all sees only SNI, so any rule that
 * constrains method or path — or dials a non-443 port — is invisible to it;
 * wildcard 443 rules stay on the L4 path. Every surface that writes rules
 * (manual create/update, inbox verdicts) must apply this, or the rule shows
 * as active while HTTPS traffic bypasses it (#2322).
 */
export function needsL7Promotion(
  method: string,
  pathPattern: string,
  port?: number,
): boolean {
  return method !== "*" || pathPattern !== "*" || port != null;
}

/** A rule shape as seen by promotion: enough to decide L7 and whose host
 *  to project onto `spec.l7Hosts`. */
export interface PromotionRule {
  host: string;
  method: string;
  pathPattern: string;
  port?: number;
  source: string;
}

/**
 * The deduped, sorted set of hosts an agent must carry on `spec.l7Hosts`,
 * given its active rules. This is the single definition every writer
 * shares (live create/update/revoke, inbox verdicts, startup backfill) so
 * they converge on one value and never fight each other into a gateway
 * roll.
 *
 * Connection-derived rules are excluded even when narrow: their host is
 * already TLS-terminated by the connection's own credential chain, so
 * listing it here would be redundant (the controller dedupes by host) and
 * would churn the roll digest. Promotion is for hosts a rule narrows that
 * have no credential of their own.
 *
 * The bare `*` host is excluded too: there is no single SNI chain that
 * terminates every host, so a narrowing on `*` cannot be projected onto
 * `spec.l7Hosts` (whose entries must be DNS names — the CRD rejects `*`).
 * Such a rule is enforced at L7 only on hosts that are independently
 * intercepted; on the L4 path it degrades to host granularity, exactly as
 * it always has.
 */
export function promotedHosts(rules: readonly PromotionRule[]): string[] {
  const hosts = rules
    .filter((r) => r.host !== "*")
    .filter((r) => !r.source.startsWith("connection:"))
    .filter((r) => needsL7Promotion(r.method, r.pathPattern, r.port))
    .map((r) => r.host);
  return [...new Set(hosts)].sort();
}
