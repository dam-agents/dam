// UNIT_BOUNDARY_DESCRIPTION: a stored egress rule may name a port, and the gateway forwards to whatever port the request carries, so a rule must speak only for the port it names. A rule with no port speaks only for the scheme's default port — 443 for TLS (CONNECT or SNI), 80 for plain HTTP — so a host-wide allow never opens the host's other services.
export function rulePortCovers(
  rulePort: number | undefined,
  port: number,
  tls: boolean,
): boolean {
  return (rulePort ?? (tls ? 443 : 80)) === port;
}
