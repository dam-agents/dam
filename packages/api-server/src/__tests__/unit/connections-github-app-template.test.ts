import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Contribution, SecretRef } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { templateToView } from "../../modules/connections/domain/connection-template.js";
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
    repositories: string;
    repositoryIds: string;
    permissions: string;
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

  it("stores the parsed scope on the auth config", async () => {
    const built = await build({
      repositories: "docs, handbook",
      permissions: "contents:read metadata:read",
    });
    if (built.auth.kind !== "github-app") throw new Error("wrong kind");
    expect(built.auth.repositories).toEqual(["docs", "handbook"]);
    expect(built.auth.permissions).toEqual({
      contents: "read",
      metadata: "read",
    });
  });

  it("leaves the scope off entirely when nothing is narrowed", async () => {
    const built = await build();
    if (built.auth.kind !== "github-app") throw new Error("wrong kind");
    expect(built.auth).not.toHaveProperty("repositories");
    expect(built.auth).not.toHaveProperty("permissions");
  });

  it("treats a blank scope as no narrowing", async () => {
    const built = await build({ repositories: "  ", permissions: "" });
    if (built.auth.kind !== "github-app") throw new Error("wrong kind");
    expect(built.auth).not.toHaveProperty("repositories");
    expect(built.auth).not.toHaveProperty("permissions");
  });

  it("fails the create on an unusable scope rather than storing it", async () => {
    await expect(build({ repositories: "dam-agents/docs" })).rejects.toThrow(
      /just the repository name/,
    );
    await expect(build({ permissions: "contents" })).rejects.toThrow(
      /name:level/,
    );
  });

  it("stores picked repository ids on the auth config", async () => {
    const built = await build({ repositoryIds: "12 34" });
    if (built.auth.kind !== "github-app") throw new Error("wrong kind");
    expect(built.auth.repositoryIds).toEqual([12, 34]);
    expect(built.auth).not.toHaveProperty("repositories");
  });

  it("offers the scope as optional form inputs", () => {
    const view = templateToView(
      template(),
      "https://cb.example/oauth/callback",
    );
    const byName = new Map(view.inputs.map((i) => [i.name, i]));
    expect(byName.get("repositories")?.state).toBe("optional");
    expect(byName.get("permissions")?.state).toBe("optional");
    expect(
      view.inputs.filter((i) => i.state === "required").map((i) => i.name),
    ).toEqual(["appId", "installationId", "privateKey"]);
  });
});
