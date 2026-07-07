import { X509Certificate } from "node:crypto";
import type { Contribution } from "api-server-api";

export const KUBERNETES_TEMPLATE_ID = "kubernetes";

// One kubeconfig per connection at its own path; the env driver joins their
// KUBECONFIG entries so kubectl/oc merges them (multiple clusters compose).
const KUBECONFIG_DIR = "$HOME/.kube/connections";

// kubectl's TLS peer is the gateway's intercept cert, not the real cluster.
const PLATFORM_CA_PATH = "/etc/platform/ca/ca.crt";

// kubectl won't send a request with a credential-less user (oc will), so the
// user carries an inert placeholder the gateway overwrites on the wire.
const KUBECONFIG_PLACEHOLDER_TOKEN = "injected-by-gateway";

export interface KubernetesTarget {
  host: string;
  port?: number;
  hasUpstreamCa: boolean;
}

/** Parse an `oc login`-style endpoint: optional scheme, host, optional
 *  `:port`, ignored path. Returns the bare host (IPv6 debracketed) and the
 *  port unless 443. String ops, not regex, to avoid ReDoS over user input. */
export function parseClusterEndpoint(raw: string): {
  host: string;
  port?: number;
} {
  const trimmed = raw.trim();
  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { host: trimmed };
  }
  const raw6 = url.hostname;
  const host =
    raw6.startsWith("[") && raw6.endsWith("]") ? raw6.slice(1, -1) : raw6;
  const port = url.port ? Number(url.port) : undefined;
  return port && port !== 443 ? { host, port } : { host };
}

/** A wire-injected bearer credential plus a ready-to-use kubeconfig. The real
 *  token never reaches the pod — the gateway injects it on the wire. */
export function buildKubernetesContributions(
  target: KubernetesTarget,
): Contribution[] {
  if (isIpLiteral(target.host)) {
    throw new Error(
      `"${target.host}" looks like an IP address. The Kubernetes API server ` +
        "must be given as a DNS hostname — the gateway routes upstream by TLS " +
        "SNI, which clients don't send for IPs. Managed clusters (IBM Cloud, " +
        "EKS, GKE, AKS, OpenShift) all expose a DNS endpoint; use that " +
        "(e.g. https://c111-e.us-east.containers.cloud.ibm.com:30767).",
    );
  }
  const server = `https://${target.host}${target.port ? `:${target.port}` : ""}`;
  const kubeconfigPath = `${KUBECONFIG_DIR}/${fileSlug(target.host, target.port)}.config`;
  return [
    {
      kind: "egress-inject",
      host: target.host,
      ...(target.port ? { port: target.port } : {}),
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
      upgrades: true,
      ...(target.hasUpstreamCa ? { upstreamCa: true } : {}),
    },
    { kind: "env", name: "KUBECONFIG", placeholder: kubeconfigPath },
    {
      kind: "file",
      path: kubeconfigPath,
      format: "yaml",
      mergeMode: "overwrite",
      content: {
        apiVersion: "v1",
        kind: "Config",
        clusters: [
          {
            name: target.host,
            cluster: {
              server,
              "certificate-authority": PLATFORM_CA_PATH,
            },
          },
        ],
        users: [
          { name: target.host, user: { token: KUBECONFIG_PLACEHOLDER_TOKEN } },
        ],
        contexts: [
          {
            name: target.host,
            context: { cluster: target.host, user: target.host },
          },
        ],
        "current-context": target.host,
      },
    },
  ];
}

/** Accepts PEM or base64-of-PEM (kubeconfig `certificate-authority-data`),
 *  returns PEM. Rejects non-certificates, which would crash-loop the gateway
 *  when Envoy failed to load them as `trusted_ca`. */
export function decodeCaData(caData: string): string {
  const trimmed = caData.trim();
  const pem = trimmed.startsWith("-----BEGIN ")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8").trim();
  if (!pem.startsWith("-----BEGIN CERTIFICATE-----")) {
    throw new Error(
      "CA must be one or more PEM certificates, or the base64 " +
        "certificate-authority-data value from a kubeconfig.",
    );
  }
  try {
    new X509Certificate(pem);
  } catch {
    throw new Error("CA certificate is not a valid X.509 certificate.");
  }
  return pem;
}

// Host is already bracket-stripped, so a remaining ':' means bare IPv6.
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

// Per-endpoint kubeconfig filename; distinct endpoints get distinct files.
function fileSlug(host: string, port?: number): string {
  return `${host}${port ? `-${port}` : ""}`.replace(/[^a-zA-Z0-9.-]/g, "_");
}
