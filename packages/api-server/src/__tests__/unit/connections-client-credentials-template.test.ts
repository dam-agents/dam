import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Contribution, SecretRef } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import {
  connectionSecretAnnotations,
  CONNECTION_TOKEN_PLACEHOLDER,
} from "../../modules/connections/domain/connection-sds.js";
import type {
  DiscoveredIssuer,
  DiscoveredIssuerMetadata,
} from "../../modules/connections/infrastructure/mcp-discovery.js";

const discoverIssuerMetadata =
  vi.fn<(issuerUrl: string) => Promise<DiscoveredIssuerMetadata | null>>();
const discoverIssuerFromResourceHost =
  vi.fn<(origin: string) => Promise<DiscoveredIssuer | null>>();

vi.mock(
  "../../modules/connections/infrastructure/mcp-discovery.js",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    discoverIssuerMetadata: (issuerUrl: string) =>
      discoverIssuerMetadata(issuerUrl),
    discoverIssuerFromResourceHost: (origin: string) =>
      discoverIssuerFromResourceHost(origin),
  }),
);

function mintRef(purpose: string): SecretRef {
  return { storeId: "k8s", path: `secret-${purpose}`, field: "" };
}

function template() {
  const t = buildCatalog().find((t) => t.id === "custom-client-credentials");
  if (!t) throw new Error("custom-client-credentials missing from catalog");
  return t;
}

async function build(
  input: Partial<{
    host: string;
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    scopes: string;
    audience: string;
    headerName: string;
    valueFormat: string;
    envName: string;
  }> = {},
) {
  return buildConnection(
    template(),
    {
      templateId: "custom-client-credentials",
      name: "my-api",
      authKind: "client-credentials",
      host: "api.example.com",
      issuerUrl: "https://auth.example.com/realms/main",
      clientId: "cid",
      clientSecret: "csecret",
      ...input,
    },
    mintRef,
    "https://cb.example/oauth/callback",
    "Test",
  );
}

function injectOf(contributions: Contribution[]) {
  const c = contributions.find((c) => c.kind === "egress-inject");
  if (c?.kind !== "egress-inject") throw new Error("no egress-inject");
  return c;
}

describe("custom-client-credentials template build", () => {
  beforeEach(() => {
    discoverIssuerMetadata.mockReset();
    discoverIssuerMetadata.mockResolvedValue({
      tokenEndpoint: "https://auth.example.com/realms/main/token",
      grantTypesSupported: ["client_credentials", "authorization_code"],
    });
    discoverIssuerFromResourceHost.mockReset();
    discoverIssuerFromResourceHost.mockResolvedValue(null);
  });

  it("projects inputs into client-credentials auth, resolving the token endpoint from the issuer", async () => {
    const built = await build({ scopes: "read write", audience: "aud" });
    expect(discoverIssuerMetadata).toHaveBeenCalledWith(
      "https://auth.example.com/realms/main",
    );
    expect(built.auth).toEqual({
      kind: "client-credentials",
      clientId: "cid",
      clientSecretRef: {
        storeId: "k8s",
        path: "secret-connection:custom-client-credentials",
        field: "client_secret",
      },
      accessTokenRef: {
        storeId: "k8s",
        path: "secret-connection:custom-client-credentials",
        field: "access_token",
      },
      issuerUrl: "https://auth.example.com/realms/main",
      tokenUrl: "https://auth.example.com/realms/main/token",
      scopes: ["read", "write"],
      audience: "aud",
      host: "api.example.com",
    });
  });

  it("rejects an issuer with no discoverable OAuth metadata", async () => {
    discoverIssuerMetadata.mockResolvedValue(null);
    await expect(build()).rejects.toThrow(/metadata/);
  });

  it("derives the authorization server from the host when no issuer is given", async () => {
    discoverIssuerFromResourceHost.mockResolvedValue({
      issuerUrl: "https://auth.example.com/realms/derived",
      tokenEndpoint: "https://auth.example.com/realms/derived/token",
    });
    const built = await build({ issuerUrl: "" });
    expect(discoverIssuerFromResourceHost).toHaveBeenCalledWith(
      "https://api.example.com",
    );
    expect(discoverIssuerMetadata).not.toHaveBeenCalled();
    if (built.auth.kind !== "client-credentials") throw new Error("wrong kind");
    expect(built.auth.issuerUrl).toBe(
      "https://auth.example.com/realms/derived",
    );
    expect(built.auth.tokenUrl).toBe(
      "https://auth.example.com/realms/derived/token",
    );
  });

  it("derives from the host including a pinned port", async () => {
    discoverIssuerFromResourceHost.mockResolvedValue({
      issuerUrl: "https://api.example.com:8443",
      tokenEndpoint: "https://api.example.com:8443/token",
    });
    await build({ host: "api.example.com:8443", issuerUrl: "" });
    expect(discoverIssuerFromResourceHost).toHaveBeenCalledWith(
      "https://api.example.com:8443",
    );
  });

  it("asks for an explicit issuer when host-derivation finds nothing", async () => {
    await expect(build({ issuerUrl: "" })).rejects.toThrow(
      /supply the issuer URL/,
    );
  });

  it("rejects an issuer that advertises grants without client_credentials", async () => {
    discoverIssuerMetadata.mockResolvedValue({
      tokenEndpoint: "https://auth.example.com/token",
      grantTypesSupported: ["authorization_code"],
    });
    await expect(build()).rejects.toThrow(/client_credentials/);
  });

  it("accepts metadata that does not advertise grant types", async () => {
    discoverIssuerMetadata.mockResolvedValue({
      tokenEndpoint: "https://auth.example.com/token",
    });
    const built = await build();
    expect(
      built.auth.kind === "client-credentials" ? built.auth.tokenUrl : "",
    ).toBe("https://auth.example.com/token");
  });

  it("defaults the injection to Authorization: Bearer", async () => {
    const built = await build();
    expect(injectOf(built.contributions)).toMatchObject({
      host: "api.example.com",
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    });
  });

  it("honors an overridden header name and format", async () => {
    const built = await build({
      headerName: "X-Token",
      valueFormat: "{value}",
    });
    expect(injectOf(built.contributions)).toMatchObject({
      headerName: "X-Token",
      valueFormat: "{value}",
    });
  });

  it("splits a host:port endpoint into host + pinned port", async () => {
    const built = await build({ host: "api.example.com:8443" });
    expect(injectOf(built.contributions)).toMatchObject({
      host: "api.example.com",
      port: 8443,
    });
  });

  it("splits scopes on spaces and commas", async () => {
    const built = await build({ scopes: "read, write  admin" });
    expect(
      built.auth.kind === "client-credentials" ? built.auth.scopes : [],
    ).toEqual(["read", "write", "admin"]);
  });

  it("emits an env contribution carrying only the placeholder", async () => {
    const built = await build({ envName: "MY_TOKEN" });
    const env = built.contributions.find((c) => c.kind === "env");
    expect(env).toMatchObject({
      name: "MY_TOKEN",
      placeholder: CONNECTION_TOKEN_PLACEHOLDER,
    });
  });

  it("stores only the client secret — no token material at build time", async () => {
    const built = await build();
    expect(
      built.secrets.get("secret-connection:custom-client-credentials"),
    ).toEqual({ client_secret: "csecret" });
  });

  it("carries the injection host to the controller annotation", async () => {
    const built = await build();
    const raw = connectionSecretAnnotations(built.contributions)[
      "agent-platform.ai/injection-hosts"
    ];
    const entries = JSON.parse(raw) as Record<string, unknown>[];
    expect(entries[0]).toMatchObject({
      host: "api.example.com",
      headerName: "Authorization",
    });
  });

  it.each([
    ["host", { host: "" }],
    ["clientId", { clientId: "" }],
    ["clientSecret", { clientSecret: "" }],
  ])("rejects a missing %s", async (field, override) => {
    await expect(build(override)).rejects.toThrow(
      new RegExp(`missing ${field}`),
    );
  });
});
