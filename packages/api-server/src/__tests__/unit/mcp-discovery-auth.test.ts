import { describe, it, expect } from "vitest";
import { discoverMcpAuth } from "../../modules/connections/infrastructure/mcp-discovery.js";

// TEST_OVERVIEW: discoverMcpAuth locates the OAuth authorization server behind an MCP endpoint. RFC 9728 serves a resource's metadata under the well-known prefix followed by the resource's own path; older servers serve it at the origin instead, and both must keep working.

const AS = "https://auth.example.com";

const AS_METADATA = {
  authorization_endpoint: `${AS}/authorize`,
  token_endpoint: `${AS}/token`,
  registration_endpoint: `${AS}/register`,
};

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

describe("discoverMcpAuth", () => {
  // TEST_SCENARIO: origin metadata names the root audience only; a non-root prefix or a root named by path metadata cannot silently select an unrelated resource.
  it.each([
    ["/a", "https://mcp.example.com/.well-known/oauth-protected-resource"],
    ["", "https://mcp.example.com/.well-known/oauth-protected-resource/a/mcp"],
  ])("ignores %s resource at %s", async (path, candidate) => {
    const { impl, urls } = fetchStub({
      [candidate]: {
        resource: `https://mcp.example.com${path}`,
        authorization_servers: [AS],
      },
      [`${AS}/.well-known/oauth-authorization-server`]: AS_METADATA,
    });
    expect(
      await discoverMcpAuth(new URL("https://mcp.example.com/a/mcp"), impl),
    ).toBeNull();
    expect(urls).not.toContain(`${AS}/.well-known/oauth-authorization-server`);
  });

  // TEST_SCENARIO: an origin-level resource document can name the server root as the audience for an MCP endpoint below it.
  it("accepts an origin resource from origin-level metadata", async () => {
    const { impl } = fetchStub({
      "https://mcp.example.com/.well-known/oauth-protected-resource": {
        resource: "https://mcp.example.com",
        authorization_servers: [AS],
        scopes_supported: ["mcp:read"],
      },
      [`${AS}/.well-known/oauth-authorization-server`]: AS_METADATA,
    });
    expect(
      await discoverMcpAuth(new URL("https://mcp.example.com/mcp"), impl),
    ).toMatchObject({
      resource: "https://mcp.example.com",
      scopes: ["mcp:read"],
    });
  });

  // TEST_SCENARIO: the metadata's resource is the audience the server checks. Root URLs and trailing slashes must retain the declared audience rather than acquire a different spelling.
  it.each([
    ["https://mcp.example.com", "https://mcp.example.com"],
    ["https://mcp.example.com/mcp/", "https://mcp.example.com/mcp"],
  ])("keeps the metadata resource for %s", async (input, resource) => {
    const path = new URL(input).pathname.replace(/\/$/, "");
    const { impl } = fetchStub({
      [`https://mcp.example.com/.well-known/oauth-protected-resource${path}`]: {
        resource,
        authorization_servers: [AS],
      },
      [`${AS}/.well-known/oauth-authorization-server`]: AS_METADATA,
    });
    const meta = await discoverMcpAuth(new URL(input), impl);
    expect(meta?.resource).toBe(resource);
  });

  // TEST_SCENARIO: metadata for another resource cannot choose this connection's authorization server or scopes.
  it.each([
    "https://other.example.com/mcp",
    "https://mcp.example.com/other",
    "https://mcp.example.com/mcp#fragment",
    "https://mcp.example.com/mcp?tenant=other",
  ])("ignores a protected metadata document naming %s", async (resource) => {
    const { impl, urls } = fetchStub({
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp": {
        resource,
        authorization_servers: [AS],
      },
      [`${AS}/.well-known/oauth-authorization-server`]: AS_METADATA,
    });
    expect(
      await discoverMcpAuth(new URL("https://mcp.example.com/mcp"), impl),
    ).toBeNull();
    expect(urls).not.toContain(`${AS}/.well-known/oauth-authorization-server`);
  });

  // TEST_SCENARIO: an older server exposes only authorization-server metadata. The MCP endpoint still supplies the resource identifier, without borrowing the server's unrelated scope catalog.
  it("keeps resource binding when discovery falls back to authorization-server metadata", async () => {
    const { impl } = fetchStub({
      "https://mcp.example.com/.well-known/oauth-authorization-server": {
        ...AS_METADATA,
        scopes_supported: ["openid", "service_account"],
      },
    });
    const meta = await discoverMcpAuth(
      new URL("https://mcp.example.com/mcp/"),
      impl,
    );
    expect(meta?.resource).toBe("https://mcp.example.com/mcp");
    expect(meta?.scopes).toBeUndefined();
  });
  // TEST_SCENARIO: hosted MCP servers answer at the path-suffixed URL only, and their endpoint carries query parameters that are not part of the resource path. Probing the origin alone finds nothing, which is what made such a server unusable as an OAuth connection.
  it("reads metadata served under the resource path", async () => {
    const { impl, urls } = fetchStub({
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp": {
        authorization_servers: [AS],
      },
      [`${AS}/.well-known/oauth-authorization-server`]: AS_METADATA,
    });

    const meta = await discoverMcpAuth(
      new URL("https://mcp.example.com/mcp?project_ref=abc"),
      impl,
    );

    expect(meta).toEqual({
      source: "protected-resource",
      resource: "https://mcp.example.com/mcp",
      authorizationEndpoint: `${AS}/authorize`,
      tokenEndpoint: `${AS}/token`,
      registrationEndpoint: `${AS}/register`,
    });
    expect(urls[0]).toBe(
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
    );
  });

  // TEST_SCENARIO: a server that answers at the origin-level URL only still resolves, so adding the path-suffixed probe cannot regress connections that work today.
  it("falls back to the origin-level metadata URL", async () => {
    const { impl } = fetchStub({
      "https://mcp.example.com/.well-known/oauth-protected-resource": {
        authorization_servers: [AS],
      },
      [`${AS}/.well-known/oauth-authorization-server`]: AS_METADATA,
    });

    const meta = await discoverMcpAuth(
      new URL("https://mcp.example.com/sse"),
      impl,
    );

    expect(meta?.tokenEndpoint).toBe(`${AS}/token`);
  });

  // TEST_SCENARIO: an authorization server that accepts a Client ID Metadata Document says so in its metadata, often with no registration endpoint at all. Discovery must carry the flag, or the platform cannot tell such a server from one it cannot connect to.
  it("reports client ID metadata document support", async () => {
    const { impl } = fetchStub({
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp": {
        authorization_servers: [AS],
      },
      [`${AS}/.well-known/oauth-authorization-server`]: {
        authorization_endpoint: `${AS}/authorize`,
        token_endpoint: `${AS}/token`,
        client_id_metadata_document_supported: true,
      },
    });

    const meta = await discoverMcpAuth(
      new URL("https://mcp.example.com/mcp"),
      impl,
    );

    expect(meta).toEqual({
      source: "protected-resource",
      resource: "https://mcp.example.com/mcp",
      authorizationEndpoint: `${AS}/authorize`,
      tokenEndpoint: `${AS}/token`,
      clientIdMetadataDocumentSupported: true,
    });
  });
  // TEST_SCENARIO: a shared authorization server advertises scopes for many resources, including scopes this client cannot request. The MCP resource's own list is the authority for this connection.
  it("requests the resource scopes instead of the authorization server scopes", async () => {
    const { impl } = fetchStub({
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp": {
        authorization_servers: [AS],
        scopes_supported: ["mcp:read", "offline_access"],
      },
      [`${AS}/.well-known/oauth-authorization-server`]: {
        ...AS_METADATA,
        scopes_supported: ["openid", "service_account", "mcp:read"],
      },
    });

    const meta = await discoverMcpAuth(
      new URL("https://mcp.example.com/mcp"),
      impl,
    );

    expect(meta?.scopes).toEqual(["mcp:read", "offline_access"]);
  });

  // TEST_SCENARIO: a resource can omit scope guidance. Discovery must not turn the authorization server's realm-wide list into a request for unrelated permissions.
  it("does not substitute authorization server scopes when the resource omits them", async () => {
    const { impl } = fetchStub({
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp": {
        authorization_servers: [AS],
      },
      [`${AS}/.well-known/oauth-authorization-server`]: {
        ...AS_METADATA,
        scopes_supported: ["openid", "service_account"],
      },
    });

    const meta = await discoverMcpAuth(
      new URL("https://mcp.example.com/mcp"),
      impl,
    );

    expect(meta?.scopes).toBeUndefined();
  });
});
