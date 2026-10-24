import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { SecretRef } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { createOAuthRoutes } from "../../modules/connections/oauth-routes.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import type { OAuthCallbackDeps } from "../../modules/connections/oauth-routes.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import { unused } from "../helpers/connections-service.js";

/**
 * TEST_OVERVIEW: a Custom MCP server (OAuth) connection gets its client the
 * way the MCP authorization spec orders it: a client ID the user entered, else
 * the platform's Client ID Metadata Document URL when the authorization server
 * accepts one, else Dynamic Client Registration. The document is served at the
 * URL used as the client_id, without sign-in, and names the OAuth callback as
 * its only redirect URI.
 */

const AS = "https://auth.example.com";
const MCP_URL = "https://mcp.example.com/mcp";
const UI = "https://platform.example.com";
const CALLBACK = `${UI}/api/oauth/callback`;
const METADATA_URL = `${UI}/api/oauth/client-metadata.json`;

interface AsMetadata {
  registration?: boolean;
  cimd?: boolean;
}

function mcpServer(as: AsMetadata): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (
        url ===
        "https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
      )
        return Response.json({ authorization_servers: [AS] });
      if (url === `${AS}/.well-known/oauth-authorization-server`)
        return Response.json({
          authorization_endpoint: `${AS}/authorize`,
          token_endpoint: `${AS}/token`,
          ...(as.registration
            ? { registration_endpoint: `${AS}/register` }
            : {}),
          ...(as.cimd ? { client_id_metadata_document_supported: true } : {}),
        });
      if (url === `${AS}/register` && init?.method === "POST")
        return Response.json({ client_id: "dcr-client" });
      return new Response("not found", { status: 404 });
    },
  );
  return { calls };
}

function mintRef(purpose: string): SecretRef {
  return { storeId: "k8s", path: `secret-${purpose}`, field: "" };
}

function mcpOAuthTemplate() {
  const t = buildCatalog().find((t) => t.id === "custom-mcp-oauth");
  if (!t) throw new Error("custom-mcp-oauth template missing from catalog");
  return t;
}

function build(callbackUrl = CALLBACK, clientId?: string) {
  return buildConnection(
    mcpOAuthTemplate(),
    {
      templateId: "custom-mcp-oauth",
      authKind: "oauth",
      name: "mcp",
      url: MCP_URL,
      ...(clientId ? { clientId } : {}),
    },
    mintRef,
    callbackUrl,
    "Test",
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("custom MCP OAuth client", () => {
  // TEST_SCENARIO: the authorization server accepts a metadata document and has no registration endpoint. Before, this server could not be connected at all; now the document URL is the client ID.
  it("uses the metadata document URL when the server accepts one", async () => {
    mcpServer({ cimd: true });

    const built = await build();

    expect(built.auth).toMatchObject({
      kind: "oauth",
      clientId: METADATA_URL,
      authorizationUrl: `${AS}/authorize`,
      tokenUrl: `${AS}/token`,
    });
    expect(built.auth).not.toHaveProperty("clientSecretRef");
    expect(built.secrets.size).toBe(0);
  });

  // TEST_SCENARIO: a server that offers both is not registered with: the spec puts the metadata document before DCR, and each registration leaves one more client on the server.
  it("prefers the metadata document over registration", async () => {
    const { calls } = mcpServer({ cimd: true, registration: true });

    const built = await build();

    expect(built.auth).toMatchObject({ clientId: METADATA_URL });
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });

  // TEST_SCENARIO: a server without metadata document support keeps the DCR path that works today.
  it("falls back to registration", async () => {
    const { calls } = mcpServer({ registration: true });

    const built = await build();

    expect(built.auth).toMatchObject({ clientId: "dcr-client" });
    expect(calls).toContain(`POST ${AS}/register`);
  });

  // TEST_SCENARIO: an authorization server only fetches an HTTPS client_id, so a deployment served over plain HTTP (a local cluster) registers instead of sending a client ID the server refuses.
  it("registers when the platform is not served over HTTPS", async () => {
    mcpServer({ cimd: true, registration: true });

    const built = await build("http://localhost:4444/api/oauth/callback");

    expect(built.auth).toMatchObject({ clientId: "dcr-client" });
  });

  // TEST_SCENARIO: a client ID the user entered wins over both, as a pre-registered client does in the spec.
  it("keeps a client ID the user entered", async () => {
    const { calls } = mcpServer({ cimd: true, registration: true });

    const built = await build(CALLBACK, "pre-registered");

    expect(built.auth).toMatchObject({ clientId: "pre-registered" });
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });

  // TEST_SCENARIO: with neither option the build fails and tells the user what to enter instead.
  it("fails with neither registration nor a metadata document", async () => {
    mcpServer({});

    await expect(build()).rejects.toThrow(/enter a client ID/);
  });
});

describe("discoverMcp", () => {
  function service(callbackUrl = CALLBACK) {
    return createConnectionsService({
      harnesses: { default: "claude-code", harnesses: [] },
      ownerId: "owner",
      templates: createConnectionTemplateRegistry(buildCatalog()),
      repo: unused(),
      secretStore: unused<SecretStore>(),
      fanOut: unused(),
      oauthFlow: unused(),
      oauthEngine: unused(),
      githubAppEngine: unused(),
      s3CredentialProbe: unused(),
      providerBalance: unused(),
      credentialProbe: unused(),
      providerKeyProbe: unused(),
      oauthCallbackUrl: callbackUrl,
      brandName: "Test",
      connectionLock: (_key, fn) => fn(),
      isOwnedAgent: async () => true,
      resolveKbShare: unused(),
    });
  }

  // TEST_SCENARIO: the create form and the CLI pick the OAuth template from this answer; a server that accepts only a metadata document is an OAuth server, not an auth-less one.
  it("reports OAuth for a server that accepts only a metadata document", async () => {
    mcpServer({ cimd: true });

    await expect(service().discoverMcp({ url: MCP_URL })).resolves.toEqual({
      auth: "oauth",
    });
  });

  // TEST_SCENARIO: on a deployment served over plain HTTP the create path cannot use a metadata document, so discovery must not offer OAuth that create then refuses.
  it("reports none for a metadata-document-only server on a plain-HTTP deployment", async () => {
    mcpServer({ cimd: true });

    await expect(
      service("http://localhost:4444/api/oauth/callback").discoverMcp({
        url: MCP_URL,
      }),
    ).resolves.toEqual({ auth: "none" });
  });

  // TEST_SCENARIO: a server with neither way to get a client stays reported as auth-less, as before.
  it("reports none when the server offers no way to get a client", async () => {
    mcpServer({});

    await expect(service().discoverMcp({ url: MCP_URL })).resolves.toEqual({
      auth: "none",
    });
  });
});

describe("client ID metadata document route", () => {
  // TEST_SCENARIO: the authorization server fetches the document at the client_id URL and checks that client_id equals that URL and that the redirect URI of the request is listed.
  it("serves the document at the URL used as the client ID", async () => {
    const app = new Hono().route(
      "/api/oauth",
      createOAuthRoutes(
        unused<OAuthCallbackDeps>({ uiBaseUrl: UI, brandName: "Test" }),
      ),
    );

    const res = await app.request(new URL(METADATA_URL).pathname);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      client_id: METADATA_URL,
      client_name: "Test Agent Platform",
      client_uri: UI,
      redirect_uris: [CALLBACK],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });
});
