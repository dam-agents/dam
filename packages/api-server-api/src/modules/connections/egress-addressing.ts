import type { Contribution } from "agent-runtime-api";

export const CONNECTION_EGRESS_PATH_SEGMENT = "__platform_conn";

export function connectionEgressPathPrefix(connectionId: string): string {
  return `/${CONNECTION_EGRESS_PATH_SEGMENT}/${connectionId}`;
}

const addressedPath = new RegExp(
  `^/${CONNECTION_EGRESS_PATH_SEGMENT}/[A-Za-z0-9._~-]+(?=/)`,
);

export function stripConnectionEgressPrefix(path: string): string {
  return path.replace(addressedPath, "");
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

function parseUrl(raw: string): URL | undefined {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

function addressedMcpEntry(
  entry: McpEntry,
  connectionId: string,
  hosts: ReadonlySet<string>,
): McpEntry {
  const url = parseUrl(entry.url);
  if (!url || !hosts.has(url.hostname.toLowerCase())) return entry;
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

interface InjectionClaim {
  host: string;
  header: string;
  scope: string;
  addressed: boolean;
}

interface ClaimingConnection {
  id: string;
  contributions: Contribution[];
}

function injectionScope(pathPattern: string | undefined): string {
  const trimmed = (pathPattern ?? "").trim().replace(/\*$/, "");
  if (trimmed === "" || trimmed === "/") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function addressedHosts(contributions: Contribution[]): Set<string> {
  const injected = injectedHosts(contributions);
  const hosts = new Set<string>();
  for (const c of contributions) {
    if (c.kind !== "mcp-entry") continue;
    const hostname = parseUrl(c.url)?.hostname.toLowerCase();
    if (hostname && injected.has(hostname)) hosts.add(hostname);
  }
  return hosts;
}

function injectionClaims(contributions: Contribution[]): InjectionClaim[] {
  const addressed = addressedHosts(contributions);
  return contributions.flatMap((c) => {
    if (c.kind !== "egress-inject") return [];
    const host = hostnameOf(c.host);
    return [
      {
        host,
        header: c.headerName.toLowerCase(),
        scope: injectionScope(c.pathPattern),
        addressed: !c.pathPattern && addressed.has(host),
      },
    ];
  });
}

function claimsCollide(a: InjectionClaim, b: InjectionClaim): boolean {
  return (
    a.host === b.host &&
    a.header === b.header &&
    (a.scope.startsWith(b.scope) || b.scope.startsWith(a.scope)) &&
    !(a.addressed && b.addressed)
  );
}

export function unaddressableRivalHost(
  a: ClaimingConnection,
  b: ClaimingConnection,
): string | undefined {
  if (a.id === b.id) return undefined;
  const rivalClaims = injectionClaims(b.contributions);
  return injectionClaims(a.contributions).find((claim) =>
    rivalClaims.some((rival) => claimsCollide(claim, rival)),
  )?.host;
}
