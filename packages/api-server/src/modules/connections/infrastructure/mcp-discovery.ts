/**
 * MCP authorization discovery (MCP spec 2025-06-18, §"Authorization").
 *
 * The MCP server is the OAuth-protected *resource* (RFC 9728), not the
 * authorization server. Discovery is therefore two-stage:
 *
 *   1. Fetch the resource's `oauth-protected-resource` metadata to learn
 *      which authorization server(s) it trusts and the scopes it expects.
 *   2. Fetch each AS's `oauth-authorization-server` metadata (RFC 8414,
 *      OIDC fallback) to get authorize / token / registration endpoints.
 *
 * A non-spec-compliant fallback treats the MCP origin itself as the AS —
 * older deployments host AS metadata directly at the MCP origin and we
 * keep working with them.
 */

export interface McpAuthMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  /**
   * Scopes the protected-resource document declared, or what the AS
   * advertises if the PRM omitted them. Drives the `scope` parameter on
   * the authorize URL — many MCP providers (Atlassian, Linear) require
   * specific resource scopes (e.g. `read:jira-user offline_access`) and
   * issue tokens without `offline_access` if it isn't requested.
   */
  scopes?: string[];
  /** Diagnostic: which discovery URL produced the AS metadata. */
  source: string;
}

interface ProtectedResourceMetadata {
  authorization_servers?: string[];
  scopes_supported?: string[];
}

interface AsMetadata {
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

export interface DiscoverMcpAuthOptions {
  /** Override for tests. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout. Default 5s. */
  timeoutMs?: number;
}

export async function discoverMcpAuth(
  mcpUrl: URL,
  opts: DiscoverMcpAuthOptions = {},
): Promise<McpAuthMetadata | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;

  const prm = await fetchProtectedResource(mcpUrl, fetchImpl, timeoutMs);
  const asUrls =
    prm?.authorization_servers && prm.authorization_servers.length > 0
      ? prm.authorization_servers
      : // Legacy fallback: the MCP origin itself acts as the AS. Required for
        // pre-2025-06 MCP servers that never published PRM.
        [mcpUrl.origin];

  for (const asUrl of asUrls) {
    const result = await fetchAuthServer(asUrl, fetchImpl, timeoutMs);
    if (!result) continue;
    const { meta, source } = result;
    if (!meta.authorization_endpoint || !meta.token_endpoint) continue;
    const scopes = prm?.scopes_supported ?? meta.scopes_supported;
    return {
      authorizationEndpoint: meta.authorization_endpoint,
      tokenEndpoint: meta.token_endpoint,
      ...(meta.registration_endpoint
        ? { registrationEndpoint: meta.registration_endpoint }
        : {}),
      ...(scopes && scopes.length > 0 ? { scopes } : {}),
      source,
    };
  }
  return null;
}

async function fetchProtectedResource(
  mcpUrl: URL,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ProtectedResourceMetadata | null> {
  // RFC 9728 §3.1: path-aware variant appends the resource path after the
  // well-known segment. Bare-origin variant covers servers that publish a
  // single PRM doc per origin regardless of resource path.
  const pathSuffix =
    mcpUrl.pathname === "/" ? "" : mcpUrl.pathname.replace(/\/$/, "");
  const candidates = pathSuffix
    ? [
        `${mcpUrl.origin}/.well-known/oauth-protected-resource${pathSuffix}`,
        `${mcpUrl.origin}/.well-known/oauth-protected-resource`,
      ]
    : [`${mcpUrl.origin}/.well-known/oauth-protected-resource`];
  for (const url of candidates) {
    const data = await fetchJson<ProtectedResourceMetadata>(
      url,
      fetchImpl,
      timeoutMs,
    );
    if (data && Array.isArray(data.authorization_servers)) return data;
  }
  return null;
}

async function fetchAuthServer(
  asUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ meta: AsMetadata; source: string } | null> {
  // RFC 8414 §3: .well-known goes between host and path, preserving any
  // path component on the issuer URL. OIDC discovery places it after the
  // issuer path. Try every shape — providers disagree.
  const parsed = new URL(asUrl);
  const basePath = parsed.pathname.replace(/\/$/, "");
  const origin = parsed.origin;
  const candidates = [
    `${origin}/.well-known/oauth-authorization-server${basePath}`,
    `${origin}${basePath}/.well-known/oauth-authorization-server`,
    `${origin}/.well-known/openid-configuration${basePath}`,
    `${origin}${basePath}/.well-known/openid-configuration`,
  ];
  // Deduplicate (basePath === "" collapses all four to two unique URLs).
  const seen = new Set<string>();
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    const meta = await fetchJson<AsMetadata>(url, fetchImpl, timeoutMs);
    if (meta) return { meta, source: url };
  }
  return null;
}

async function fetchJson<T>(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<T | null> {
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
