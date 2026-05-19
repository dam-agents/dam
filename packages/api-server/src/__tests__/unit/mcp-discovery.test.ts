import { describe, it, expect, vi } from "vitest";

import { discoverMcpAuth } from "../../modules/connections/infrastructure/mcp-discovery.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function notFound(): Response {
  return new Response("not found", { status: 404 });
}

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    return handler(url);
  }) as unknown as typeof fetch;
}

describe("discoverMcpAuth", () => {
  it("follows protected-resource metadata to a separate authorization server", async () => {
    const fetchImpl = mockFetch((url) => {
      if (
        url === "https://mcp.example.com/.well-known/oauth-protected-resource"
      ) {
        return jsonResponse({
          authorization_servers: ["https://auth.example.com"],
          scopes_supported: ["mcp:read", "offline_access"],
        });
      }
      if (
        url ===
        "https://auth.example.com/.well-known/oauth-authorization-server"
      ) {
        return jsonResponse({
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          registration_endpoint: "https://auth.example.com/register",
        });
      }
      return notFound();
    });

    const meta = await discoverMcpAuth(new URL("https://mcp.example.com/sse"), {
      fetchImpl,
    });

    expect(meta).toEqual({
      authorizationEndpoint: "https://auth.example.com/authorize",
      tokenEndpoint: "https://auth.example.com/token",
      registrationEndpoint: "https://auth.example.com/register",
      scopes: ["mcp:read", "offline_access"],
      source: "https://auth.example.com/.well-known/oauth-authorization-server",
    });
  });

  it("prefers PRM scopes over AS scopes_supported", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.endsWith("/.well-known/oauth-protected-resource")) {
        return jsonResponse({
          authorization_servers: ["https://auth.example.com"],
          scopes_supported: ["resource:scope"],
        });
      }
      if (url.endsWith("/.well-known/oauth-authorization-server")) {
        return jsonResponse({
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          registration_endpoint: "https://auth.example.com/register",
          scopes_supported: ["everything"],
        });
      }
      return notFound();
    });
    const meta = await discoverMcpAuth(new URL("https://mcp.example.com/"), {
      fetchImpl,
    });
    expect(meta?.scopes).toEqual(["resource:scope"]);
  });

  it("falls back to AS scopes_supported when PRM omits them", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.endsWith("/.well-known/oauth-protected-resource")) {
        return jsonResponse({
          authorization_servers: ["https://auth.example.com"],
        });
      }
      if (url.endsWith("/.well-known/oauth-authorization-server")) {
        return jsonResponse({
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          registration_endpoint: "https://auth.example.com/register",
          scopes_supported: ["everything"],
        });
      }
      return notFound();
    });
    const meta = await discoverMcpAuth(new URL("https://mcp.example.com/"), {
      fetchImpl,
    });
    expect(meta?.scopes).toEqual(["everything"]);
  });

  it("tries the path-aware PRM URL before the bare-origin form (RFC 9728 §3.1)", async () => {
    const calls: string[] = [];
    const fetchImpl = mockFetch((url) => {
      calls.push(url);
      if (
        url ===
        "https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
      ) {
        return jsonResponse({
          authorization_servers: ["https://auth.example.com"],
        });
      }
      if (
        url ===
        "https://auth.example.com/.well-known/oauth-authorization-server"
      ) {
        return jsonResponse({
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          registration_endpoint: "https://auth.example.com/register",
        });
      }
      return notFound();
    });
    const meta = await discoverMcpAuth(new URL("https://mcp.example.com/mcp"), {
      fetchImpl,
    });
    expect(meta?.authorizationEndpoint).toBe(
      "https://auth.example.com/authorize",
    );
    expect(calls[0]).toBe(
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("falls back to bare-origin PRM when the path-aware variant 404s", async () => {
    const fetchImpl = mockFetch((url) => {
      if (
        url === "https://mcp.example.com/.well-known/oauth-protected-resource"
      ) {
        return jsonResponse({
          authorization_servers: ["https://auth.example.com"],
        });
      }
      if (
        url ===
        "https://auth.example.com/.well-known/oauth-authorization-server"
      ) {
        return jsonResponse({
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          registration_endpoint: "https://auth.example.com/register",
        });
      }
      return notFound();
    });
    const meta = await discoverMcpAuth(new URL("https://mcp.example.com/mcp"), {
      fetchImpl,
    });
    expect(meta?.authorizationEndpoint).toBe(
      "https://auth.example.com/authorize",
    );
  });

  it("falls back to treating the MCP origin as the AS when PRM is missing", async () => {
    const fetchImpl = mockFetch((url) => {
      if (
        url === "https://mcp.example.com/.well-known/oauth-authorization-server"
      ) {
        return jsonResponse({
          authorization_endpoint: "https://mcp.example.com/authorize",
          token_endpoint: "https://mcp.example.com/token",
          registration_endpoint: "https://mcp.example.com/register",
        });
      }
      return notFound();
    });
    const meta = await discoverMcpAuth(new URL("https://mcp.example.com/sse"), {
      fetchImpl,
    });
    expect(meta?.authorizationEndpoint).toBe(
      "https://mcp.example.com/authorize",
    );
  });

  it("falls back to OIDC discovery when oauth-authorization-server is absent", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.endsWith("/.well-known/oauth-protected-resource")) {
        return jsonResponse({
          authorization_servers: ["https://auth.example.com"],
        });
      }
      if (url === "https://auth.example.com/.well-known/openid-configuration") {
        return jsonResponse({
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          registration_endpoint: "https://auth.example.com/register",
        });
      }
      return notFound();
    });
    const meta = await discoverMcpAuth(new URL("https://mcp.example.com/"), {
      fetchImpl,
    });
    expect(meta?.source).toBe(
      "https://auth.example.com/.well-known/openid-configuration",
    );
  });

  it("respects AS path component when fetching RFC 8414 metadata", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.endsWith("/.well-known/oauth-protected-resource")) {
        return jsonResponse({
          authorization_servers: ["https://auth.example.com/tenant-a"],
        });
      }
      if (
        url ===
        "https://auth.example.com/.well-known/oauth-authorization-server/tenant-a"
      ) {
        return jsonResponse({
          authorization_endpoint: "https://auth.example.com/tenant-a/authorize",
          token_endpoint: "https://auth.example.com/tenant-a/token",
          registration_endpoint: "https://auth.example.com/tenant-a/register",
        });
      }
      return notFound();
    });
    const meta = await discoverMcpAuth(new URL("https://mcp.example.com/"), {
      fetchImpl,
    });
    expect(meta?.tokenEndpoint).toBe("https://auth.example.com/tenant-a/token");
  });

  it("returns null when no discovery shape succeeds", async () => {
    const fetchImpl = mockFetch(() => notFound());
    const meta = await discoverMcpAuth(new URL("https://mcp.example.com/"), {
      fetchImpl,
    });
    expect(meta).toBeNull();
  });

  it("rejects AS metadata missing required endpoints", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.endsWith("/.well-known/oauth-protected-resource")) {
        return jsonResponse({
          authorization_servers: ["https://auth.example.com"],
        });
      }
      if (url.endsWith("/.well-known/oauth-authorization-server")) {
        return jsonResponse({
          authorization_endpoint: "https://auth.example.com/authorize",
        });
      }
      return notFound();
    });
    const meta = await discoverMcpAuth(new URL("https://mcp.example.com/"), {
      fetchImpl,
    });
    expect(meta).toBeNull();
  });

  it("does not propagate network errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const meta = await discoverMcpAuth(new URL("https://mcp.example.com/"), {
      fetchImpl,
    });
    expect(meta).toBeNull();
  });
});
