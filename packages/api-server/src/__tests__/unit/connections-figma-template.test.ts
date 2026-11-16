import { afterEach, describe, expect, it, vi } from "vitest";
import type { SecretRef } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { templateToView } from "../../modules/connections/domain/connection-template.js";

/**
 * TEST_OVERVIEW: the built-in Figma connection reaches Figma's own MCP server.
 * The server URL is fixed by the template, so the user enters nothing but a
 * name. Figma's registration endpoint admits only the clients in its MCP
 * catalog, by the client_name they register with, so the template registers
 * under a name Figma admits instead of the platform's own.
 */

const MCP_URL = "https://mcp.figma.com/mcp";
const AS = "https://api.figma.com";
const CALLBACK = "https://platform.example.com/api/oauth/callback";

function figmaServer(): { registrations: Record<string, unknown>[] } {
  const registrations: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (
        url === "https://mcp.figma.com/.well-known/oauth-protected-resource/mcp"
      )
        return Response.json({
          resource: MCP_URL,
          authorization_servers: [AS],
          scopes_supported: ["mcp:connect"],
        });
      if (url === `${AS}/.well-known/oauth-authorization-server`)
        return Response.json({
          authorization_endpoint: "https://www.figma.com/oauth/mcp",
          token_endpoint: `${AS}/v1/oauth/token`,
          registration_endpoint: `${AS}/v1/oauth/mcp/register`,
          scopes_supported: ["mcp:connect"],
        });
      if (url === `${AS}/v1/oauth/mcp/register` && init?.method === "POST") {
        registrations.push(JSON.parse(String(init.body)));
        return Response.json({
          client_id: "figma-client",
          client_secret: "figma-secret",
        });
      }
      return new Response("not found", { status: 404 });
    },
  );
  return { registrations };
}

function figmaTemplate() {
  const t = buildCatalog().find((t) => t.id === "figma");
  if (!t) throw new Error("figma template missing from catalog");
  return t;
}

function mintRef(purpose: string): SecretRef {
  return { storeId: "k8s", path: `secret-${purpose}`, field: "" };
}

function build() {
  return buildConnection(
    figmaTemplate(),
    { templateId: "figma", authKind: "oauth", name: "figma" },
    mintRef,
    CALLBACK,
    "Test",
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Figma connection", () => {
  // TEST_SCENARIO: Figma answers 403 to a registration under the platform's own name, so the template registers as "Claude Code", a client Figma admits.
  it("registers with Figma under the Claude Code client name", async () => {
    const { registrations } = figmaServer();

    await build();

    expect(registrations).toEqual([
      expect.objectContaining({
        client_name: "Claude Code",
        redirect_uris: [CALLBACK],
      }),
    ]);
  });

  // TEST_SCENARIO: the user gives no URL; the connection reaches Figma's MCP server, the gateway injects its token there, and the scope Figma publishes is asked for.
  it("exposes Figma's MCP server with the token injected by the gateway", async () => {
    figmaServer();

    const built = await build();

    expect(built.auth).toMatchObject({
      kind: "oauth",
      clientId: "figma-client",
      scopes: ["mcp:connect"],
      authorizationUrl: "https://www.figma.com/oauth/mcp",
      tokenUrl: `${AS}/v1/oauth/token`,
      clientSecretRef: {
        path: "secret-connection:figma",
        field: "client_secret",
      },
    });
    expect(built.secrets.get("secret-connection:figma")).toEqual({
      client_secret: "figma-secret",
    });
    expect(built.contributions).toEqual([
      {
        kind: "egress-inject",
        host: "mcp.figma.com",
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
      {
        kind: "mcp-entry",
        name: "figma",
        url: MCP_URL,
        headers: { Authorization: "Bearer dummy-placeholder" },
      },
    ]);
  });

  // TEST_SCENARIO: the create form asks only for a name, since the URL and the client are the template's.
  it("asks the user for no inputs", () => {
    const view = templateToView(figmaTemplate(), CALLBACK);

    expect(view).toMatchObject({ category: "mcp", authKind: "oauth" });
    expect(view.inputs).toEqual([]);
    expect(view.extras?.callbackUrl).toBeUndefined();
  });
});
