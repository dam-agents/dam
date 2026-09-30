import type { Contribution } from "agent-runtime-api";
import { githubHostOf } from "./github-host.js";
import { DEFAULT_ENV_PLACEHOLDER } from "./providers.js";

export const CONNECTION_EGRESS_PATH_SEGMENT = "__platform_conn";
export const CONNECTION_EGRESS_PLACEHOLDER_PREFIX = "platform:conn:";

export function connectionEgressPathPrefix(connectionId: string): string {
  return `/${CONNECTION_EGRESS_PATH_SEGMENT}/${connectionId}`;
}

export function connectionEgressPlaceholder(connectionId: string): string {
  return `${CONNECTION_EGRESS_PLACEHOLDER_PREFIX}${connectionId}`;
}

const addressedPath = new RegExp(
  `^/${CONNECTION_EGRESS_PATH_SEGMENT}/[A-Za-z0-9._~-]+(?=/)`,
);

export function stripConnectionEgressPrefix(path: string): string {
  return path.replace(addressedPath, "");
}

type EgressInject = Extract<Contribution, { kind: "egress-inject" }>;
type McpEntry = Extract<Contribution, { kind: "mcp-entry" }>;

function injectedHosts(contributions: readonly Contribution[]): Set<string> {
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

function withPlaceholder(value: unknown, placeholder: string): unknown {
  if (value === DEFAULT_ENV_PLACEHOLDER) return placeholder;
  if (Array.isArray(value)) {
    return value.map((item) => withPlaceholder(item, placeholder));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        withPlaceholder(item, placeholder),
      ]),
    );
  }
  return value;
}

function containsPlaceholder(value: unknown): boolean {
  if (value === DEFAULT_ENV_PLACEHOLDER) return true;
  if (Array.isArray(value)) return value.some(containsPlaceholder);
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(containsPlaceholder);
  }
  return false;
}

function mentionsPlaceholder(headers: Record<string, string> | undefined) {
  return Object.values(headers ?? {}).some((value) =>
    value.includes(DEFAULT_ENV_PLACEHOLDER),
  );
}

function headersWithPlaceholder(
  headers: Record<string, string>,
  placeholder: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      value.split(DEFAULT_ENV_PLACEHOLDER).join(placeholder),
    ]),
  );
}

export function carriesCredentialPlaceholder(
  contributions: readonly Contribution[],
): boolean {
  return contributions.some(
    (c) =>
      (c.kind === "env" && c.placeholder === DEFAULT_ENV_PLACEHOLDER) ||
      (c.kind === "file" && containsPlaceholder(c.content)) ||
      (c.kind === "mcp-entry" && mentionsPlaceholder(c.headers)),
  );
}

export function applyConnectionEgressAddressing(
  connectionId: string,
  contributions: Contribution[],
): Contribution[] {
  if (!contributions.some((c) => c.kind === "egress-inject")) {
    return contributions;
  }
  const hosts = injectedHosts(contributions);
  const placeholder = connectionEgressPlaceholder(connectionId);
  return contributions.map((c) => {
    switch (c.kind) {
      case "mcp-entry": {
        const entry = addressedMcpEntry(c, connectionId, hosts);
        return entry.headers
          ? {
              ...entry,
              headers: headersWithPlaceholder(entry.headers, placeholder),
            }
          : entry;
      }
      case "env":
        return c.placeholder === DEFAULT_ENV_PLACEHOLDER
          ? { ...c, placeholder }
          : c;
      case "file":
        return c.content === undefined
          ? c
          : { ...c, content: withPlaceholder(c.content, placeholder) };
      default:
        return c;
    }
  });
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

function pathAddressedHosts(contributions: Contribution[]): Set<string> {
  const injected = injectedHosts(contributions);
  const hosts = new Set<string>();
  for (const c of contributions) {
    if (c.kind !== "mcp-entry") continue;
    const hostname = parseUrl(c.url)?.hostname.toLowerCase();
    if (hostname && injected.has(hostname)) hosts.add(hostname);
  }
  return hosts;
}

function credentialEnvNames(contributions: Contribution[]): Set<string> {
  const names = new Set<string>();
  for (const c of contributions) {
    if (c.kind === "env" && c.placeholder === DEFAULT_ENV_PLACEHOLDER) {
      names.add(c.name);
    }
  }
  return names;
}

function placeholdersReachTheAgent(
  a: ClaimingConnection,
  b: ClaimingConnection,
): boolean {
  if (
    !carriesCredentialPlaceholder(a.contributions) ||
    !carriesCredentialPlaceholder(b.contributions)
  ) {
    return false;
  }
  const github = githubHostOf(a.contributions);
  if (github !== undefined && github === githubHostOf(b.contributions)) {
    return true;
  }
  const taken = credentialEnvNames(a.contributions);
  return [...credentialEnvNames(b.contributions)].every(
    (name) => !taken.has(name),
  );
}

function injectionClaims(
  contributions: Contribution[],
  byValue: boolean,
): InjectionClaim[] {
  const byPath = pathAddressedHosts(contributions);
  return contributions.flatMap((c) => {
    if (c.kind !== "egress-inject") return [];
    const host = hostnameOf(c.host);
    return [
      {
        host,
        header: c.headerName.toLowerCase(),
        scope: injectionScope(c.pathPattern),
        addressed: byValue || (!c.pathPattern && byPath.has(host)),
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
  const byValue = placeholdersReachTheAgent(a, b);
  const rivalClaims = injectionClaims(b.contributions, byValue);
  return injectionClaims(a.contributions, byValue).find((claim) =>
    rivalClaims.some((rival) => claimsCollide(claim, rival)),
  )?.host;
}
