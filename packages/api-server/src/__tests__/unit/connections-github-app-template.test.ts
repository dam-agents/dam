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
  const t = buildCatalog().find((t) => t.id === "github-app");
  if (!t) throw new Error("github-app missing from catalog");
  return t;
}

function build(
  input: Partial<{
    appId: string;
    installationId: string;
    privateKey: string;
  }> = {},
) {
  return buildConnection(
    template(),
    {
      templateId: "github-app",
      name: "my-app",
      authKind: "github-app",
      appId: "123456",
      installationId: "987654",
      privateKey: PRIVATE_KEY_PEM,
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

describe("github-app template build", () => {
  it("projects inputs into github-app auth", async () => {
    const built = await build();
    expect(built.auth).toEqual({
      kind: "github-app",
      appId: "123456",
      installationId: "987654",
      privateKeyRef: {
        storeId: "k8s",
        path: "secret-connection:github-app",
        field: "private_key",
      },
      accessTokenRef: {
        storeId: "k8s",
        path: "secret-connection:github-app",
        field: "access_token",
      },
      apiBaseUrl: "https://api.github.com",
      host: "github.com",
    });
  });

  it("contributes GH_TOKEN plus the three GitHub host injections", async () => {
    const built = await build();
    const env = built.contributions.find((c) => c.kind === "env");
    expect(env).toMatchObject({ name: "GH_TOKEN" });
    expect(hostsOf(built.contributions)).toEqual([
      "api.github.com",
      "github.com",
      "raw.githubusercontent.com",
    ]);
    // github.com uses Basic x-access-token so git-over-HTTPS works.
    const git = built.contributions.find(
      (c) => c.kind === "egress-inject" && c.host === "github.com",
    );
    expect(git).toMatchObject({
      valueFormat: "Basic {value}",
      encoding: "basic-x-access-token",
    });
  });

  it("stores only the normalized private key — no token material at build time", async () => {
    const built = await build();
    expect(built.secrets.get("secret-connection:github-app")).toEqual({
      private_key: PRIVATE_KEY_PEM.trim(),
    });
  });

  it("accepts a base64-encoded PEM and normalizes it", async () => {
    const b64 = Buffer.from(PRIVATE_KEY_PEM, "utf8").toString("base64");
    const built = await build({ privateKey: b64 });
    expect(built.secrets.get("secret-connection:github-app")).toEqual({
      private_key: PRIVATE_KEY_PEM.trim(),
    });
  });

  it("accepts a PEM with escaped newlines and restores them", async () => {
    const escaped = PRIVATE_KEY_PEM.replace(/\n/g, "\\n");
    const built = await build({ privateKey: escaped });
    expect(built.secrets.get("secret-connection:github-app")).toEqual({
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
      "api.github.com",
      "github.com",
      "raw.githubusercontent.com",
    ]);
  });

  it("rejects an invalid private key", async () => {
    await expect(build({ privateKey: "not-a-key" })).rejects.toThrow(
      /PEM-encoded/,
    );
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
});
