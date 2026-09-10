/**
 * UNIT_BOUNDARY_DESCRIPTION: The agent's network, which is the whole egress
 * boundary. Each sandbox gets a namespace whose only interface is one end of a
 * /30 point-to-point link; the other end is the address its paired gateway
 * binds. The sandbox is given no default route and no resolver, so its routing
 * table can express exactly one destination. There is no rule to get wrong
 * because there is no second route to deny. The nftables ruleset here is
 * defence in depth: it stops the node forwarding anything off these links.
 */
const BASE_OCTETS = [100, 64, 0, 0] as const;
const MAX_INDEX = 16_383;

export interface SandboxLink {
  index: number;
  hostAddress: string;
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

export function allocateIndex(taken: Iterable<number>): number {
  const used = new Set(taken);
  for (let i = 0; i <= MAX_INDEX; i++) if (!used.has(i)) return i;
  throw new Error("no sandbox link addresses left");
}

export function indexOfAddress(sandboxAddress: string): number | null {
  const offset = ipToInt(sandboxAddress) - ipToInt(BASE_OCTETS.join("."));
  if (offset < 2 || offset % 4 !== 2) return null;
  const index = (offset - 2) / 4;
  return index <= MAX_INDEX ? index : null;
}

export interface NftablesInput {
  links: readonly SandboxLink[];
  gatewayPort: number;
  sandboxPort: number;
}

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
  lines.push(
    "  }",
    "  chain input {",
    "    type filter hook input priority filter; policy accept;",
  );
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
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    throw new TypeError(`not an IPv4 address: ${ip}`);
  }
  return (
    ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!
  );
}

function intToIp(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}
