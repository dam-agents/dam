import type { Contribution } from "api-server-api";

export const KUBERNETES_TEMPLATE_ID = "kubernetes";

const KUBECONFIG_PATH = "$HOME/.kube/config";

// The MITM CA the controller mounts into every agent pod. kubectl's TLS peer
// is the paired gateway's intercept cert, never the real cluster — the
// cluster's own CA (if any) lives gateway-side via `upstreamCa`.
const PLATFORM_CA_PATH = "/etc/platform/ca/ca.crt";

// kubectl/client-go refuses to send a request when its kubeconfig user has no
// credential at all — it drops to an interactive username prompt instead of
// issuing an anonymous call (oc does issue one). So the user carries a
// non-secret placeholder Bearer token; the gateway's credential injector
// (overwrite: true) replaces it with the real service-account token on the
// wire. The token never leaves the gateway; this string is inert.
const KUBECONFIG_PLACEHOLDER_TOKEN = "injected-by-gateway";

export interface KubernetesTarget {
  host: string;
  port?: number;
  hasUpstreamCa: boolean;
}

/** Parse a cluster API endpoint the way `oc login` / `kubectl` accept it: an
 *  optional `http(s)://` scheme, a host (DNS name, IPv4, or bracketed IPv6),
 *  an optional `:port`, and an ignored path. Returns the bare host (IPv6
 *  without brackets) and the explicit port if one was given. `:443`
 *  normalizes away since it's the default everywhere downstream. */
export function parseClusterEndpoint(raw: string): {
  host: string;
  port?: number;
} {
  const trimmed = raw.trim();
  // Scheme detection without a regex over user input: a `://` means it's
  // already a URL; otherwise it's a bare host[:port] and we add https. `URL`
  // does the actual (bounded, non-backtracking) parsing.
  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    // Not URL-shaped — hand the raw string on so validation reports it.
    return { host: trimmed };
  }
  // Strip IPv6 brackets by slice, not regex.
  const raw6 = url.hostname;
  const host =
    raw6.startsWith("[") && raw6.endsWith("]") ? raw6.slice(1, -1) : raw6;
  const port = url.port ? Number(url.port) : undefined;
  return port && port !== 443 ? { host, port } : { host };
}

/** Contributions for a Kubernetes/OpenShift API-server connection: one
 *  wire-injected bearer credential and a ready-to-use kubeconfig. The
 *  kubeconfig's user entry is deliberately empty — the token never reaches
 *  the agent pod; the gateway injects `Authorization` on the wire. */
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
    {
      kind: "file",
      path: KUBECONFIG_PATH,
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

/** Accepts PEM directly or base64-of-PEM (kubeconfig
 *  `certificate-authority-data`); returns PEM. */
export function decodeCaData(caData: string): string {
  const trimmed = caData.trim();
  if (trimmed.startsWith("-----BEGIN ")) return trimmed;
  let decoded: string;
  try {
    decoded = Buffer.from(trimmed, "base64").toString("utf8");
  } catch {
    throw new Error("CA certificate must be PEM or base64-encoded PEM");
  }
  if (!decoded.trimStart().startsWith("-----BEGIN ")) {
    throw new Error(
      "CA certificate must be PEM or base64-encoded PEM (the " +
        "certificate-authority-data value from a kubeconfig)",
    );
  }
  return decoded;
}

// The host here is already scheme- and bracket-stripped by
// parseClusterEndpoint, so a remaining ':' means a bare IPv6 literal.
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}
