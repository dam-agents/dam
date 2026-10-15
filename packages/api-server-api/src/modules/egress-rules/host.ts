// UNIT_BOUNDARY_DESCRIPTION: the form in which the egress gate compares a request host with a rule host: DNS ignores letter case and the agent writes the Host header and SNI, so `API.GitHub.com` must meet the rules for `api.github.com`.
export function canonicalEgressHost(host: string): string {
  return host.toLowerCase();
}
