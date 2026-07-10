import { describe, it, expect } from "vitest";
import {
  discoverIssuerFromResourceHost,
  discoverIssuerMetadata,
} from "../../modules/connections/infrastructure/mcp-discovery.js";

const ISSUER = "https://auth.example.com/realms/main";

function fetchStub(routes: Record<string, unknown>): {
  impl: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const impl = (async (url: RequestInfo | URL) => {
    urls.push(String(url));
    const body = routes[String(url)];
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { impl, urls };
}

describe("discoverIssuerMetadata", () => {
  it("reads RFC 8414 authorization-server metadata", async () => {
    const { impl } = fetchStub({
      [`${ISSUER}/.well-known/oauth-authorization-server`]: {
        token_endpoint: `${ISSUER}/token`,
        grant_types_supported: ["client_credentials"],
      },
    });
    expect(await discoverIssuerMetadata(ISSUER, impl)).toEqual({
      tokenEndpoint: `${ISSUER}/token`,
      grantTypesSupported: ["client_credentials"],
    });
  });

  it("falls back to OIDC discovery when RFC 8414 metadata is absent", async () => {
    const { impl, urls } = fetchStub({
      [`${ISSUER}/.well-known/openid-configuration`]: {
        token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
      },
    });
    expect(await discoverIssuerMetadata(ISSUER, impl)).toEqual({
      tokenEndpoint: `${ISSUER}/protocol/openid-connect/token`,
    });
    expect(urls).toEqual([
      `${ISSUER}/.well-known/oauth-authorization-server`,
      `${ISSUER}/.well-known/openid-configuration`,
    ]);
  });

  it("does not require an authorization endpoint (pure M2M issuers)", async () => {
    const { impl } = fetchStub({
      [`${ISSUER}/.well-known/oauth-authorization-server`]: {
        token_endpoint: `${ISSUER}/token`,
      },
    });
    expect(await discoverIssuerMetadata(ISSUER, impl)).not.toBeNull();
  });

  it("returns null when neither well-known document resolves", async () => {
    const { impl } = fetchStub({});
    expect(await discoverIssuerMetadata(ISSUER, impl)).toBeNull();
  });

  it("returns null when metadata lacks a token endpoint", async () => {
    const { impl } = fetchStub({
      [`${ISSUER}/.well-known/openid-configuration`]: { issuer: ISSUER },
    });
    expect(await discoverIssuerMetadata(ISSUER, impl)).toBeNull();
  });

  it("tolerates a trailing slash on the issuer", async () => {
    const { impl } = fetchStub({
      [`${ISSUER}/.well-known/oauth-authorization-server`]: {
        token_endpoint: `${ISSUER}/token`,
      },
    });
    expect(await discoverIssuerMetadata(`${ISSUER}/`, impl)).not.toBeNull();
  });
});

describe("discoverIssuerFromResourceHost", () => {
  const HOST = "https://api.example.com";

  it("follows the protected-resource metadata to the named authorization server", async () => {
    const { impl } = fetchStub({
      [`${HOST}/.well-known/oauth-protected-resource`]: {
        authorization_servers: [ISSUER],
      },
      [`${ISSUER}/.well-known/oauth-authorization-server`]: {
        token_endpoint: `${ISSUER}/token`,
      },
    });
    expect(await discoverIssuerFromResourceHost(HOST, impl)).toEqual({
      issuerUrl: ISSUER,
      tokenEndpoint: `${ISSUER}/token`,
    });
  });

  it("treats the host itself as the issuer when it serves AS metadata", async () => {
    const { impl } = fetchStub({
      [`${HOST}/.well-known/openid-configuration`]: {
        token_endpoint: `${HOST}/token`,
      },
    });
    expect(await discoverIssuerFromResourceHost(HOST, impl)).toEqual({
      issuerUrl: HOST,
      tokenEndpoint: `${HOST}/token`,
    });
  });

  it("falls back to the host when the named authorization server has no metadata", async () => {
    const { impl } = fetchStub({
      [`${HOST}/.well-known/oauth-protected-resource`]: {
        authorization_servers: ["https://gone.example.com"],
      },
      [`${HOST}/.well-known/oauth-authorization-server`]: {
        token_endpoint: `${HOST}/token`,
      },
    });
    expect(await discoverIssuerFromResourceHost(HOST, impl)).toEqual({
      issuerUrl: HOST,
      tokenEndpoint: `${HOST}/token`,
    });
  });

  it("returns null when nothing is discoverable", async () => {
    const { impl } = fetchStub({});
    expect(await discoverIssuerFromResourceHost(HOST, impl)).toBeNull();
  });
});
