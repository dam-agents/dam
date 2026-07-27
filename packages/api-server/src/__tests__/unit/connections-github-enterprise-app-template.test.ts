import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Contribution, SecretRef } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { connectionSecretAnnotations } from "../../modules/connections/domain/connection-sds.js";

const { privateKey: PRIVATE_KEY_PEM } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

function mintRef(purpose: string): SecretRef {
  return { storeId: "k8s", path: `secret-${purpose}`, field: "" };
}

function template() {
  const t = buildCatalog().find((t) => t.id === "github-enterprise-app");
  if (!t) throw new Error("github-enterprise-app missing from catalog");
  return t;
}

function build(
  input: Partial<{
    appId: string;
    installationId: string;
    privateKey: string;
    host: string;
    apiBaseUrl: string;
  }> = {},
) {
  return buildConnection(
    template(),
    {
      templateId: "github-enterprise-app",
      name: "my-ghe-app",
      authKind: "github-app",
      appId: "123456",
      installationId: "987654",
      privateKey: PRIVATE_KEY_PEM,
      host: "ghe.acme.com",
      ...input,
    },
    mintRef,
    "https://cb.example/oauth/callback",
    "Test",
  );
}

function hostsOf(contributions: Contribution[]): string[] {
  return contributions
    .filter((c) => c.kind === "egress-inject")
    .map((c) => (c.kind === "egress-inject" ? c.host : ""));
}

describe("github-enterprise-app template build", () => {
  it("projects inputs into github-app auth with the enterprise host", async () => {
    const built = await build();
    expect(built.auth).toEqual({
      kind: "github-app",
      appId: "123456",
      installationId: "987654",
      privateKeyRef: {
        storeId: "k8s",
        path: "secret-connection:github-enterprise-app",
        field: "private_key",
      },
      accessTokenRef: {
        storeId: "k8s",
        path: "secret-connection:github-enterprise-app",
        field: "access_token",
      },
      apiBaseUrl: "https://api.ghe.acme.com",
      host: "ghe.acme.com",
    });
  });

  it("honors an explicit apiBaseUrl override", async () => {
    const built = await build({
      apiBaseUrl: "https://ghe.acme.com/api/v3",
    });
    expect(built.auth).toMatchObject({
      apiBaseUrl: "https://ghe.acme.com/api/v3",
      host: "ghe.acme.com",
    });
  });

  it("contributes GH_TOKEN, GH_HOST, and the host-derived Bearer/Basic injections", async () => {
    const built = await build();
    const env = built.contributions.filter((c) => c.kind === "env");
    expect(env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "GH_TOKEN" }),
        expect.objectContaining({
          name: "GH_HOST",
          placeholder: "ghe.acme.com",
        }),
      ]),
    );
    expect(hostsOf(built.contributions)).toEqual([
      "api.ghe.acme.com",
      "ghe.acme.com",
    ]);
    // ghe.acme.com uses Basic x-access-token so git-over-HTTPS works.
    const git = built.contributions.find(
      (c) => c.kind === "egress-inject" && c.host === "ghe.acme.com",
    );
    expect(git).toMatchObject({
      valueFormat: "Basic {value}",
      encoding: "basic-x-access-token",
    });
    const api = built.contributions.find(
      (c) => c.kind === "egress-inject" && c.host === "api.ghe.acme.com",
    );
    expect(api).toMatchObject({ valueFormat: "Bearer {value}" });
  });

  it("stores only the normalized private key — no token material at build time", async () => {
    const built = await build();
    expect(
      built.secrets.get("secret-connection:github-enterprise-app"),
    ).toEqual({
      private_key: PRIVATE_KEY_PEM.trim(),
    });
  });

  it("carries the injection hosts to the controller annotation", async () => {
    const built = await build();
    const raw = connectionSecretAnnotations(built.contributions)[
      "agent-platform.ai/injection-hosts"
    ];
    const entries = JSON.parse(raw) as Record<string, unknown>[];
    expect(entries.map((e) => e.host)).toEqual([
      "api.ghe.acme.com",
      "ghe.acme.com",
    ]);
  });

  it("rejects a missing host", async () => {
    await expect(build({ host: "" })).rejects.toThrow(/missing host/);
  });

  it.each([
    ["appId", { appId: "" }],
    ["installationId", { installationId: "" }],
    ["privateKey", { privateKey: "" }],
  ])("rejects a missing %s", async (field, override) => {
    await expect(build(override)).rejects.toThrow(
      new RegExp(`missing ${field}`),
    );
  });

  it("leaves the plain github-app template's github.com behavior untouched", async () => {
    const t = buildCatalog().find((t) => t.id === "github-app");
    if (!t) throw new Error("github-app missing from catalog");
    const built = await buildConnection(
      t,
      {
        templateId: "github-app",
        name: "my-app",
        authKind: "github-app",
        appId: "123456",
        installationId: "987654",
        privateKey: PRIVATE_KEY_PEM,
        // A host/apiBaseUrl override has no effect outside github-enterprise-app.
        host: "ghe.acme.com",
        apiBaseUrl: "https://ghe.acme.com/api/v3",
      },
      mintRef,
      "https://cb.example/oauth/callback",
      "Test",
    );
    expect(built.auth).toMatchObject({
      apiBaseUrl: "https://api.github.com",
      host: "github.com",
    });
    expect(hostsOf(built.contributions)).toEqual([
      "api.github.com",
      "github.com",
      "raw.githubusercontent.com",
    ]);
  });
});
