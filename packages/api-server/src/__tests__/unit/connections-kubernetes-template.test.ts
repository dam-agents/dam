import { describe, it, expect } from "vitest";
import type { Contribution, SecretRef } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import {
  connectionSecretAnnotations,
  UPSTREAM_CA_SECRET_FIELD,
} from "../../modules/connections/domain/connection-sds.js";
import { contributionHash } from "../../modules/runtime-delivery/domain/contribution-hash.js";

// Real self-signed X.509 (test-only) so decodeCaData's cert validation passes.
const CA_PEM = `-----BEGIN CERTIFICATE-----
MIIDMjCCAhqgAwIBAgIUMiX4bseuRVT+8L+EjCMZs2MIUAMwDQYJKoZIhvcNAQEL
BQAwIDEeMBwGA1UEAwwVcGxhdGZvcm0tdGVzdC1jbHVzdGVyMB4XDTI2MDcwMjEy
MjM1MloXDTM2MDYyOTEyMjM1MlowIDEeMBwGA1UEAwwVcGxhdGZvcm0tdGVzdC1j
bHVzdGVyMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwI5z1cP2t3k2
wu/2LlckhwjH5UhC7WJ6hgTh9bFnvK3IKa3dvy3/yqECvK93JRMh/ADSaM9w0F3d
9q1UMidXy8T/ulb4BFNDOh07DE0W8WVbrHHZ6mXVwdSfKyB40zZ37yW0LzTLUjv7
fAbnABEmcHl7nbTKf2AfidjiU+wOr7QC/R66aLkgC3uqU45mq01bnaEwjmWTb6RY
c1GTg29HxpuBsAgCZwmwiQFYMqUbEu1i5pxL5vTIkCMw3PuPi3sOR4gF9OKs5FmW
7S+Hr9wUE1LEx6au0fVEhgDwTBPzqHCx/VXdqw3tkv1fP/TS+K4pTLXNinXwwZ2C
PF4DLJHsuQIDAQABo2QwYjAdBgNVHQ4EFgQUrbEUzJTKwRH5SYZEEFswPNzV53Qw
HwYDVR0jBBgwFoAUrbEUzJTKwRH5SYZEEFswPNzV53QwDwYDVR0TAQH/BAUwAwEB
/zAPBgNVHREECDAGhwR/AAABMA0GCSqGSIb3DQEBCwUAA4IBAQB9MglpUjdZ2vUg
5li/5lKmV3I+6SvxD40fjuNAMGTxcPWsiYDh75C4LhhlykosPRXPIDYrB//gHbLp
hvl64Ektlaoqdg8Fgy7hlJWCyLtZfCS1g3Z0oZ8nbHCNt+zuT1cFKdzeHKzAHSrD
odtUCpQz+iQ0G+u48thi1UJ+NGCkcXC72F+wYYQsKteY2qqI1R/SaXTf0zWOFUMR
iRE24pgARhd1wueI7Cpdk7FG9lZAHawuOXWODa4sbT182EcVzjG7/Ncwvjpq1Owi
JG2IiAQ+BegQRj1cxNtzkakdTQWYSSw9TdnevQSjjcjPN3jh0kbj0PnSLqhEUNzv
HUAT/xFb
-----END CERTIFICATE-----
`;

function mintRef(purpose: string): SecretRef {
  return { storeId: "k8s", path: `secret-${purpose}`, field: "" };
}

function kubernetesTemplate() {
  const t = buildCatalog().find((t) => t.id === "kubernetes");
  if (!t) throw new Error("kubernetes template missing from catalog");
  return t;
}

async function buildKubernetes(input: {
  host: string;
  value?: string;
  caData?: string;
}) {
  return buildConnection(
    kubernetesTemplate(),
    {
      templateId: "kubernetes",
      name: "my-cluster",
      authKind: "header",
      host: input.host,
      value: input.value ?? "sa-token",
      ...(input.caData ? { caData: input.caData } : {}),
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

function fileOf(contributions: Contribution[]) {
  const c = contributions.find((c) => c.kind === "file");
  if (c?.kind !== "file") throw new Error("no file contribution");
  return c;
}

function envOf(contributions: Contribution[], name: string) {
  const c = contributions.find((c) => c.kind === "env" && c.name === name);
  if (c?.kind !== "env") throw new Error(`no env contribution ${name}`);
  return c;
}

describe("kubernetes connection template", () => {
  it("splits host:port and injects Bearer with upgrade tunneling", async () => {
    const built = await buildKubernetes({ host: "api.cluster.example:6443" });
    const inject = injectOf(built.contributions);
    expect(inject).toMatchObject({
      host: "api.cluster.example",
      port: 6443,
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
      upgrades: true,
    });
  });

  it("writes a per-connection kubeconfig and points KUBECONFIG at it", async () => {
    const built = await buildKubernetes({ host: "api.cluster.example:6443" });
    const file = fileOf(built.contributions);
    expect(file.path).toBe(
      "$HOME/.kube/connections/api.cluster.example-6443.config",
    );
    // The env driver joins KUBECONFIG across connections, so it must point at
    // this connection's own file.
    expect(envOf(built.contributions, "KUBECONFIG").placeholder).toBe(
      file.path,
    );
    expect(file.format).toBe("yaml");
    expect(file.mergeMode).toBe("overwrite");
    const content = file.content as {
      clusters: {
        cluster: { server: string; "certificate-authority": string };
      }[];
      users: { user: { token?: string } }[];
    };
    expect(content.clusters[0].cluster.server).toBe(
      "https://api.cluster.example:6443",
    );
    expect(content.clusters[0].cluster["certificate-authority"]).toBe(
      "/etc/platform/ca/ca.crt",
    );
    // Real token stays gateway-side; user holds only the placeholder.
    expect(JSON.stringify(content)).not.toContain("sa-token");
    expect(content.users[0].user.token).toBe("injected-by-gateway");
  });

  it("gives distinct clusters distinct kubeconfig files (so they compose)", async () => {
    const a = fileOf(
      (await buildKubernetes({ host: "api.a.example:6443" })).contributions,
    );
    const b = fileOf(
      (await buildKubernetes({ host: "api.b.example" })).contributions,
    );
    expect(a.path).not.toBe(b.path);
  });

  it("normalizes :443 away and omits the port field", async () => {
    const built = await buildKubernetes({ host: "api.cluster.example:443" });
    const inject = injectOf(built.contributions);
    expect(inject.host).toBe("api.cluster.example");
    expect(inject.port).toBeUndefined();
    const file = fileOf(built.contributions);
    expect(
      (file.content as { clusters: { cluster: { server: string } }[] })
        .clusters[0].cluster.server,
    ).toBe("https://api.cluster.example");
  });

  it("accepts an oc login-style https:// URL and strips the scheme", async () => {
    const built = await buildKubernetes({
      host: "https://api.my-cluster.example:6443",
    });
    const inject = injectOf(built.contributions);
    expect(inject.host).toBe("api.my-cluster.example");
    expect(inject.port).toBe(6443);
    const file = fileOf(built.contributions);
    expect(
      (file.content as { clusters: { cluster: { server: string } }[] })
        .clusters[0].cluster.server,
    ).toBe("https://api.my-cluster.example:6443");
  });

  it("ignores a trailing path on the URL", async () => {
    const built = await buildKubernetes({
      host: "https://api.cluster.example:6443/",
    });
    expect(injectOf(built.contributions).host).toBe("api.cluster.example");
    expect(injectOf(built.contributions).port).toBe(6443);
  });

  it("accepts a bare host:port (no scheme)", async () => {
    const built = await buildKubernetes({ host: "api.cluster.example:6443" });
    expect(injectOf(built.contributions).host).toBe("api.cluster.example");
    expect(injectOf(built.contributions).port).toBe(6443);
  });

  it("accepts an http:// URL", async () => {
    const built = await buildKubernetes({ host: "http://api.cluster.example" });
    expect(injectOf(built.contributions).host).toBe("api.cluster.example");
    expect(injectOf(built.contributions).port).toBeUndefined();
  });

  it("rejects IP-literal API hosts (no SNI, gateway cannot route them)", async () => {
    await expect(buildKubernetes({ host: "10.0.0.1:6443" })).rejects.toThrow(
      /IP address/,
    );
  });

  it("rejects an https:// IP URL too", async () => {
    await expect(
      buildKubernetes({ host: "https://203.0.113.10:6443" }),
    ).rejects.toThrow(/IP address/);
  });

  it("stores a PEM CA and marks the injection upstreamCa", async () => {
    const built = await buildKubernetes({
      host: "api.cluster.example:6443",
      caData: CA_PEM,
    });
    expect(injectOf(built.contributions).upstreamCa).toBe(true);
    const fields = built.secrets.get("secret-connection:kubernetes")!;
    expect(fields[UPSTREAM_CA_SECRET_FIELD]).toBe(CA_PEM.trim());
  });

  it("accepts base64 caData (kubeconfig certificate-authority-data)", async () => {
    const built = await buildKubernetes({
      host: "api.cluster.example:6443",
      caData: Buffer.from(CA_PEM, "utf8").toString("base64"),
    });
    const fields = built.secrets.get("secret-connection:kubernetes")!;
    expect(fields[UPSTREAM_CA_SECRET_FIELD]).toBe(CA_PEM.trim());
  });

  it("rejects caData that is neither PEM nor base64 PEM", async () => {
    await expect(
      buildKubernetes({
        host: "api.cluster.example:6443",
        caData: "not-a-certificate",
      }),
    ).rejects.toThrow(/PEM/);
  });

  it("rejects a PEM that isn't a certificate (e.g. a private key)", async () => {
    // A wrong-but-PEM blob would crash-loop the gateway as a bad trusted_ca.
    await expect(
      buildKubernetes({
        host: "api.cluster.example:6443",
        caData:
          "-----BEGIN PRIVATE KEY-----\nMIIBVQ==\n-----END PRIVATE KEY-----",
      }),
    ).rejects.toThrow(/certificate/i);
  });

  it("rejects a malformed CERTIFICATE PEM", async () => {
    await expect(
      buildKubernetes({
        host: "api.cluster.example:6443",
        caData:
          "-----BEGIN CERTIFICATE-----\nnot-base64-der!!!\n-----END CERTIFICATE-----",
      }),
    ).rejects.toThrow(/valid X\.509/);
  });
});

describe("injection-hosts annotation", () => {
  it("carries port, upgrades, and caKey to the controller", async () => {
    const built = await buildKubernetes({
      host: "api.cluster.example:6443",
      caData: CA_PEM,
    });
    const raw = connectionSecretAnnotations(built.contributions)[
      "agent-platform.ai/injection-hosts"
    ];
    const entries = JSON.parse(raw) as Record<string, unknown>[];
    expect(entries[0]).toMatchObject({
      host: "api.cluster.example",
      port: 6443,
      upgrades: true,
      caKey: UPSTREAM_CA_SECRET_FIELD,
    });
  });
});

describe("contribution hash", () => {
  it("distinguishes egress contributions by port", () => {
    const at = (port?: number): Contribution[] => [
      {
        kind: "egress-inject",
        host: "api.cluster.example",
        ...(port ? { port } : {}),
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
    ];
    expect(contributionHash(at(6443))).not.toBe(contributionHash(at()));
    expect(contributionHash(at(6443))).not.toBe(contributionHash(at(8443)));
  });
});
