export interface DiscoveredMcpAuth {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopes?: string[];
}

interface AuthServerMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  grant_types_supported?: string[];
}

interface ProtectedResourceMetadata {
  authorization_servers?: string[];
}

export async function discoverMcpAuth(
  mcpUrl: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveredMcpAuth | null> {
  const base = `${mcpUrl.protocol}//${mcpUrl.host}`;

  try {
    const res = await fetchImpl(
      `${base}/.well-known/oauth-protected-resource`,
      {
        signal: AbortSignal.timeout(5000),
      },
    );
    if (res.ok) {
      const data = (await res.json()) as ProtectedResourceMetadata;
      const asUrl = data.authorization_servers?.[0];
      if (asUrl) {
        const meta = await fetchAuthServerMetadata(asUrl, fetchImpl);
        if (meta) return meta;
      }
    }
  } catch {}

  return fetchAuthServerMetadata(base, fetchImpl);
}

function wellKnownCandidates(asUrl: string): string[] {
  return [
    `${asUrl.replace(/\/$/, "")}/.well-known/oauth-authorization-server`,
    `${asUrl.replace(/\/$/, "")}/.well-known/openid-configuration`,
  ];
}

async function fetchAuthServerMetadata(
  asUrl: string,
  fetchImpl: typeof fetch,
): Promise<DiscoveredMcpAuth | null> {
  for (const url of wellKnownCandidates(asUrl)) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data = (await res.json()) as AuthServerMetadata;
      if (data.authorization_endpoint && data.token_endpoint) {
        return {
          authorizationEndpoint: data.authorization_endpoint,
          tokenEndpoint: data.token_endpoint,
          ...(data.registration_endpoint
            ? { registrationEndpoint: data.registration_endpoint }
            : {}),
          ...(data.scopes_supported && data.scopes_supported.length > 0
            ? { scopes: data.scopes_supported }
            : {}),
        };
      }
    } catch {}
  }
  return null;
}

export interface DiscoveredIssuerMetadata {
  tokenEndpoint: string;
  grantTypesSupported?: string[];
}

// Issuer-direct discovery for token-endpoint-only grants (client
// credentials): unlike the MCP path above, an authorization endpoint is not
// required — a machine-to-machine authorization server may not have one.
export async function discoverIssuerMetadata(
  issuerUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveredIssuerMetadata | null> {
  for (const url of wellKnownCandidates(issuerUrl)) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data = (await res.json()) as AuthServerMetadata;
      if (data.token_endpoint) {
        return {
          tokenEndpoint: data.token_endpoint,
          ...(data.grant_types_supported
            ? { grantTypesSupported: data.grant_types_supported }
            : {}),
        };
      }
    } catch {}
  }
  return null;
}

export interface DiscoveredIssuer extends DiscoveredIssuerMetadata {
  issuerUrl: string;
}

// When only the API host is known, find its authorization server: the host's
// protected-resource metadata (RFC 9728) names the issuer; failing that, the
// host itself may be the issuer.
export async function discoverIssuerFromResourceHost(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveredIssuer | null> {
  try {
    const res = await fetchImpl(
      `${origin.replace(/\/$/, "")}/.well-known/oauth-protected-resource`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const data = (await res.json()) as ProtectedResourceMetadata;
      const asUrl = data.authorization_servers?.[0];
      if (asUrl) {
        const meta = await discoverIssuerMetadata(asUrl, fetchImpl);
        if (meta) return { issuerUrl: asUrl, ...meta };
      }
    }
  } catch {}

  const meta = await discoverIssuerMetadata(origin, fetchImpl);
  return meta ? { issuerUrl: origin, ...meta } : null;
}

export interface DcrResult {
  clientId: string;
  clientSecret?: string;
}

export async function registerOAuthClient(opts: {
  registrationEndpoint: string;
  clientName: string;
  redirectUris: string[];
  fetchImpl?: typeof fetch;
}): Promise<DcrResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(opts.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: opts.clientName,
      redirect_uris: opts.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `DCR failed at ${opts.registrationEndpoint}: ${res.status} ${body.slice(0, 500)}`,
    );
  }
  const data = (await res.json()) as {
    client_id?: string;
    client_secret?: string;
  };
  if (!data.client_id) {
    throw new Error(
      `DCR succeeded but response missing client_id: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return {
    clientId: data.client_id,
    ...(data.client_secret ? { clientSecret: data.client_secret } : {}),
  };
}
