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
