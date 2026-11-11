import { hostMatchCandidates } from "./host-match.js";
import {
  coversEveryRequestOf,
  mayMatchOneRequest,
  ranksBefore,
} from "./gate-order.js";
import { rulePortCovers } from "./port-match.js";

interface ReachRule {
  host: string;
  port?: number;
  method: string;
  pathPattern: string;
  verdict: string;
}

interface AskedRule {
  host: string;
  port?: number;
  method?: string;
  pathPattern?: string;
}

const DEFAULT_PORTS = [
  { port: 443, tls: true },
  { port: 80, tls: false },
] as const;

// UNIT_BOUNDARY_DESCRIPTION: whether a child's allow rule reaches past its driver: it is wider when it lets through one request (a host, port, method and path) that the driver's own rules do not allow. For each port the driver's host patterns are read most specific first, as at the gate (the host, then its `*.parent`, then `*`). The rule is within the driver's reach when one allow of the driver speaks for every request the rule speaks for, and no deny of the driver may take one of those requests first: a deny under a more specific host pattern, or one under the same pattern that the gate does not rank after the allow. A doubt is read as wider, so the owner is asked. A rule with no port speaks for 443 over TLS and 80 in plain HTTP, so both must be within reach.
export function reachesPastDriver(
  rule: AskedRule,
  driverRules: readonly ReachRule[],
): boolean {
  const asked = {
    host: rule.host.trim().toLowerCase(),
    method: rule.method ?? "*",
    pathPattern: rule.pathPattern ?? "*",
  };
  const ports =
    rule.port === undefined
      ? DEFAULT_PORTS
      : [
          { port: rule.port, tls: true },
          { port: rule.port, tls: false },
        ];
  return ports.some(
    ({ port, tls }) => !driverAllows(asked, port, tls, driverRules),
  );
}

function driverAllows(
  asked: { host: string; method: string; pathPattern: string },
  port: number,
  tls: boolean,
  driverRules: readonly ReachRule[],
): boolean {
  const deniesAbove: ReachRule[] = [];
  for (const pattern of hostMatchCandidates(asked.host)) {
    const speaking = driverRules.filter(
      (r) =>
        r.host.toLowerCase() === pattern && rulePortCovers(r.port, port, tls),
    );
    const denies = speaking.filter(
      (r) => r.verdict !== "allow" && mayMatchOneRequest(r, asked),
    );
    const within = speaking.some(
      (allow) =>
        allow.verdict === "allow" &&
        coversEveryRequestOf(allow, asked) &&
        deniesAbove.length === 0 &&
        denies.every((deny) => ranksBefore(allow, deny)),
    );
    if (within) return true;
    deniesAbove.push(...denies);
  }
  return false;
}
