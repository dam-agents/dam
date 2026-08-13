import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Contribution, SecretRef } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import {
  buildCatalog,
  type OperatorCredentials,
} from "../../modules/connections/domain/catalog.js";
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

function template(creds?: OperatorCredentials) {
  const t = buildCatalog(creds).find((t) => t.id === "github-enterprise-app");
  if (!t) throw new Error("github-enterprise-app missing from catalog");
  return t;
}

function build(
  input: Partial<{
    host: string;
    appId: string;
    installationId: string;
    privateKey: string;
  }> = {},
  creds?: OperatorCredentials,
) {
  return buildConnection(
    template(creds),
    {
      templateId: "github-enterprise-app",
      name: "my-ghe-app",
      authKind: "github-app",
      host: "ghe.acme.com",
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

describe("github-enterprise-app template build", () => {
  it("substitutes the enterprise host into apiBaseUrl and auth.host", async () => {
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

  it("contributes GH_TOKEN, GH_HOST, and the enterprise host injections", async () => {
    const built = await build();
    const envNames = built.contributions
      .filter((c) => c.kind === "env")
      .map((c) => (c.kind === "env" ? c.name : ""));
    expect(envNames).toEqual(["GH_TOKEN", "GH_HOST"]);
    expect(hostsOf(built.contributions)).toEqual([
      "api.ghe.acme.com",
      "ghe.acme.com",
    ]);
    const git = built.contributions.find(
      (c) => c.kind === "egress-inject" && c.host === "ghe.acme.com",
    );
    expect(git).toMatchObject({
      valueFormat: "Basic {value}",
      encoding: "basic-x-access-token",
    });
  });

  it("rejects a missing host", async () => {
    await expect(build({ host: "" })).rejects.toThrow(/missing host/);
  });

  it("falls back to the operator-preset host when the user supplies none", async () => {
    const built = await build(
      { host: undefined },
      { githubEnterprise: { host: "ghe.operator.example" } },
    );
    expect(built.auth).toMatchObject({
      apiBaseUrl: "https://api.ghe.operator.example",
      host: "ghe.operator.example",
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

describe("github-enterprise-app template view", () => {
  it("requires a host input when the operator has not preset one", () => {
    const view = templateToView(
      template(),
      "https://cb.example/oauth/callback",
    );
    const host = view.inputs.find((i) => i.name === "host");
    expect(host).toMatchObject({ state: "required" });
  });

  it("surfaces the operator-preset host as overridable", () => {
    const view = templateToView(
      template({ githubEnterprise: { host: "ghe.operator.example" } }),
      "https://cb.example/oauth/callback",
    );
    const host = view.inputs.find((i) => i.name === "host");
    expect(host).toMatchObject({
      state: "overridable",
      presetValue: "ghe.operator.example",
    });
  });

  it("does not ask the fixed github.com template for a host", () => {
    const t = buildCatalog().find((t) => t.id === "github-app");
    if (!t) throw new Error("github-app missing from catalog");
    const view = templateToView(t, "https://cb.example/oauth/callback");
    expect(view.inputs.find((i) => i.name === "host")).toBeUndefined();
  });
});
