import type { Contribution } from "agent-runtime-api";

export const CONNECTION_EGRESS_PATH_SEGMENT = "__platform_conn";

export function connectionEgressPathPrefix(connectionId: string): string {
  return `/${CONNECTION_EGRESS_PATH_SEGMENT}/${connectionId}`;
}

type EgressInject = Extract<Contribution, { kind: "egress-inject" }>;
type McpEntry = Extract<Contribution, { kind: "mcp-entry" }>;

function injectedHosts(contributions: Contribution[]): Set<string> {
  const hosts = new Set<string>();
  for (const c of contributions) {
    if (c.kind !== "egress-inject") continue;
    const inject: EgressInject = c;
    if (inject.pathPattern) continue;
    hosts.add(hostnameOf(inject.host));
  }
  return hosts;
}

function hostnameOf(host: string): string {
  const [name] = host.toLowerCase().split(":");
  return name ?? host.toLowerCase();
}

function addressedMcpEntry(
  entry: McpEntry,
  connectionId: string,
  hosts: ReadonlySet<string>,
): McpEntry {
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    return entry;
  }
  if (!hosts.has(url.hostname.toLowerCase())) return entry;
  url.pathname = `${connectionEgressPathPrefix(connectionId)}${url.pathname}`;
  return { ...entry, url: url.toString() };
}

export function applyConnectionEgressAddressing(
  connectionId: string,
  contributions: Contribution[],
): Contribution[] {
  const hosts = injectedHosts(contributions);
  if (hosts.size === 0) return contributions;
  return contributions.map((c) =>
    c.kind === "mcp-entry" ? addressedMcpEntry(c, connectionId, hosts) : c,
  );
}
