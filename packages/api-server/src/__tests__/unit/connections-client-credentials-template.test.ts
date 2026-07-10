import { describe, it, expect } from "vitest";
import type { Contribution, SecretRef } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import {
  connectionSecretAnnotations,
  CONNECTION_TOKEN_PLACEHOLDER,
} from "../../modules/connections/domain/connection-sds.js";

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
    tokenUrl: string;
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
      tokenUrl: "https://auth.example.com/token",
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
  it("projects inputs into client-credentials auth with both refs on one secret", async () => {
    const built = await build({ scopes: "read write", audience: "aud" });
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
      tokenUrl: "https://auth.example.com/token",
      scopes: ["read", "write"],
      audience: "aud",
      host: "api.example.com",
    });
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
    ["tokenUrl", { tokenUrl: "" }],
    ["clientId", { clientId: "" }],
    ["clientSecret", { clientSecret: "" }],
  ])("rejects a missing %s", async (field, override) => {
    await expect(build(override)).rejects.toThrow(
      new RegExp(`missing ${field}`),
    );
  });
});
