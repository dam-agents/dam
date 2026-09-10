/**
 * The agent's network, which is the whole egress boundary.
 *
 * Each sandbox gets a network namespace whose only interface is one end of a
 * /30 point-to-point link. The other end lives in the host namespace and is
 * the address its paired Envoy binds. The sandbox is given no default route
 * and no resolver, so its routing table can express exactly one destination:
 * its own gateway. That is what the NetworkPolicy used to assert and what the
 * kernel now makes true by construction — there is no rule to get wrong,
 * because there is no second route to deny.
 *
 * The nftables ruleset below is therefore defence in depth rather than the
 * boundary: it stops the host from forwarding anything off these links, and
 * limits what may reach the sandbox from the host side.
 */

/** Carrier-grade NAT space: routable nowhere, and unlikely to collide with a host LAN or a container bridge. */
const BASE_OCTETS = [100, 64, 0, 0] as const;
const MAX_INDEX = 16_383; // 100.64.0.0/10 in /30 steps

export interface SandboxLink {
  index: number;
  /** Host end of the link — the address the gateway's Envoy binds. */
  hostAddress: string;
  /** Sandbox end — the address the api-server dials agent-runtime on. */
  sandboxAddress: string;
  prefixLength: 30;
  netns: string;
  hostInterface: string;
  sandboxInterface: string;
}

export function linkFor(agentId: string, index: number): SandboxLink {
  if (!Number.isInteger(index) || index < 0 || index > MAX_INDEX) {
    throw new RangeError(`sandbox link index out of range: ${index}`);
  }
  const base = ipToInt(BASE_OCTETS.join(".")) + index * 4;
  // Interface names are capped at 15 bytes by the kernel, so they are keyed by
  // index rather than by agent id — the id is in the namespace name instead.
  return {
    index,
    hostAddress: intToIp(base + 1),
    sandboxAddress: intToIp(base + 2),
    prefixLength: 30,
    netns: `dam-${agentId}`,
    hostInterface: `damh${index}`,
    sandboxInterface: `dams${index}`,
  };
}

/** Lowest index not already in use, so a deleted agent's slot is reused. */
export function allocateIndex(taken: Iterable<number>): number {
  const used = new Set(taken);
  for (let i = 0; i <= MAX_INDEX; i++) if (!used.has(i)) return i;
  throw new Error("no sandbox link addresses left");
}

/** Recovers the index a running sandbox was allocated, from its address. */
export function indexOfAddress(sandboxAddress: string): number | null {
  const offset = ipToInt(sandboxAddress) - ipToInt(BASE_OCTETS.join("."));
  if (offset < 2 || offset % 4 !== 2) return null;
  const index = (offset - 2) / 4;
  return index <= MAX_INDEX ? index : null;
}

export interface NftablesInput {
  links: readonly SandboxLink[];
  /** Port the paired Envoy listens on, the sandbox's only permitted destination. */
  gatewayPort: number;
  /** Port agent-runtime listens on, reachable only from the host. */
  sandboxPort: number;
}

/**
 * The full ruleset, rendered for `nft -f -`. It is written whole and flushed
 * atomically rather than patched per agent: a partial ruleset is the one
 * failure mode that silently opens egress, and re-rendering everything makes
 * the file the single description of what is allowed.
 */
export function nftablesRuleset(input: NftablesInput): string {
  const lines: string[] = [
    "table inet dam {",
    "  chain forward {",
    "    type filter hook forward priority filter; policy accept;",
  ];
  for (const link of input.links) {
    lines.push(
      `    iifname "${link.hostInterface}" drop comment "sandbox ${link.netns} has no route off its link"`,
    );
  }
  lines.push("  }", "  chain input {", "    type filter hook input priority filter; policy accept;");
  for (const link of input.links) {
    lines.push(
      `    iifname "${link.hostInterface}" ip saddr ${link.sandboxAddress} ip daddr ${link.hostAddress} tcp dport ${input.gatewayPort} accept`,
      `    iifname "${link.hostInterface}" drop`,
    );
  }
  lines.push("  }", "}");
  return lines.join("\n") + "\n";
}

function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new TypeError(`not an IPv4 address: ${ip}`);
  }
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

function intToIp(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}
