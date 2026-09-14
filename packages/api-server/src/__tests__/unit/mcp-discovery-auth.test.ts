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
});
