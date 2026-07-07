import { describe, it, expect } from "vitest";
import type { Contribution, SecretRef } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import {
  connectionSecretAnnotations,
  UPSTREAM_CA_SECRET_FIELD,
} from "../../modules/connections/domain/connection-sds.js";
import { contributionHash } from "../../modules/runtime-delivery/domain/contribution-hash.js";

const CA_PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

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

  it("writes a tokenless kubeconfig pointed at the platform MITM CA", async () => {
    const built = await buildKubernetes({ host: "api.cluster.example:6443" });
    const file = fileOf(built.contributions);
    expect(file.path).toBe("$HOME/.kube/config");
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
    // The real token must never land in the agent-visible kubeconfig — the
    // gateway injects it on the wire. The user carries only an inert
    // placeholder so kubectl issues a request the gateway can augment.
    expect(JSON.stringify(content)).not.toContain("sa-token");
    expect(content.users[0].user.token).toBe("injected-by-gateway");
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
      host: "https://c111-e.us-east.containers.cloud.ibm.com:30767",
    });
    const inject = injectOf(built.contributions);
    expect(inject.host).toBe("c111-e.us-east.containers.cloud.ibm.com");
    expect(inject.port).toBe(30767);
    const file = fileOf(built.contributions);
    expect(
      (file.content as { clusters: { cluster: { server: string } }[] })
        .clusters[0].cluster.server,
    ).toBe("https://c111-e.us-east.containers.cloud.ibm.com:30767");
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
      buildKubernetes({ host: "https://169.51.0.1:30767" }),
    ).rejects.toThrow(/IP address/);
  });

  it("stores a PEM CA and marks the injection upstreamCa", async () => {
    const built = await buildKubernetes({
      host: "api.cluster.example:6443",
      caData: CA_PEM,
    });
    expect(injectOf(built.contributions).upstreamCa).toBe(true);
    const fields = built.secrets.get("secret-connection:kubernetes")!;
    expect(fields[UPSTREAM_CA_SECRET_FIELD]).toBe(CA_PEM);
  });

  it("accepts base64 caData (kubeconfig certificate-authority-data)", async () => {
    const built = await buildKubernetes({
      host: "api.cluster.example:6443",
      caData: Buffer.from(CA_PEM, "utf8").toString("base64"),
    });
    const fields = built.secrets.get("secret-connection:kubernetes")!;
    expect(fields[UPSTREAM_CA_SECRET_FIELD]).toBe(CA_PEM);
  });

  it("rejects caData that is neither PEM nor base64 PEM", async () => {
    await expect(
      buildKubernetes({
        host: "api.cluster.example:6443",
        caData: "not-a-certificate",
      }),
    ).rejects.toThrow(/PEM/);
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
