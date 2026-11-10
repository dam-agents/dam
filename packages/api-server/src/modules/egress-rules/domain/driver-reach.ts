import { hostMatchCandidates } from "./host-match.js";
import { rulePortCovers } from "./port-match.js";

interface ReachRule {
  host: string;
  port?: number;
  method: string;
  pathPattern: string;
  verdict: string;
}

const DEFAULT_PORTS = [
  { port: 443, tls: true },
  { port: 80, tls: false },
] as const;

// UNIT_BOUNDARY_DESCRIPTION: whether a child's allow rule reaches past its driver: it is wider when one host and port it lets through is one the driver's own rules do not reach. Hosts and ports are compared, never methods or paths, so a driver that reaches some path of a host reaches the host. For each port the host patterns are read most specific first, as at the gate (the host, then its `*.parent`, then `*`): an allow there reaches, a deny of every method and path does not, and a deny of only some of them leaves the next pattern to decide. A rule with no port speaks for 443 over TLS and 80 in plain HTTP, so both must be reached.
export function reachesPastDriver(
  rule: { host: string; port?: number },
  driverRules: readonly ReachRule[],
): boolean {
  const host = rule.host.trim().toLowerCase();
  const ports =
    rule.port === undefined
      ? DEFAULT_PORTS
      : [
          { port: rule.port, tls: true },
          { port: rule.port, tls: false },
        ];
  return ports.some(
    ({ port, tls }) => !driverReaches(host, port, tls, driverRules),
  );
}

function driverReaches(
  host: string,
  port: number,
  tls: boolean,
  driverRules: readonly ReachRule[],
): boolean {
  for (const pattern of hostMatchCandidates(host)) {
    const speaking = driverRules.filter(
      (r) =>
        r.host.toLowerCase() === pattern && rulePortCovers(r.port, port, tls),
    );
    if (speaking.some((r) => r.verdict === "allow")) return true;
    if (speaking.some((r) => r.method === "*" && r.pathPattern === "*"))
      return false;
  }
  return false;
}
