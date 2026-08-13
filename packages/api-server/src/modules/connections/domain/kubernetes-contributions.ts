import { X509Certificate } from "node:crypto";
import type { Contribution } from "api-server-api";

export const KUBERNETES_TEMPLATE_ID = "kubernetes";

const KUBECONFIG_DIR = "$HOME/.kube/connections";

const PLATFORM_CA_PATH = "/etc/platform/ca/ca.crt";

const KUBECONFIG_PLACEHOLDER_TOKEN = "injected-by-gateway";

export interface KubernetesTarget {
  name: string;
  host: string;
  port?: number;
  hasUpstreamCa: boolean;
}

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

export function buildKubernetesContributions(
  target: KubernetesTarget,
): Contribution[] {
  if (isIpLiteral(target.host)) {
    throw new Error(
      `"${target.host}" looks like an IP address. The Kubernetes API server ` +
        "must be given as a DNS hostname — the gateway routes upstream by TLS " +
        "SNI, which clients don't send for IPs. Managed clusters (IBM Cloud, " +
        "EKS, GKE, AKS, OpenShift) all expose a DNS endpoint; use that " +
        "(e.g. https://api.my-cluster.example:6443).",
    );
  }
  const server = `https://${target.host}${target.port ? `:${target.port}` : ""}`;
  const label = target.name;
  const kubeconfigPath = `${KUBECONFIG_DIR}/${label}.config`;
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
            name: label,
            cluster: {
              server,
              "certificate-authority": PLATFORM_CA_PATH,
            },
          },
        ],
        users: [{ name: label, user: { token: KUBECONFIG_PLACEHOLDER_TOKEN } }],
        contexts: [
          {
            name: label,
            context: { cluster: label, user: label },
          },
        ],
        "current-context": label,
      },
    },
  ];
}

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

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}
