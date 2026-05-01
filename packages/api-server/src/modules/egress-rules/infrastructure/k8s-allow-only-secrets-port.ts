/**
 * Materializes "allow-only" K8s Secrets that promote a host onto Envoy's L7
 * (TLS-terminating) chain. They carry no credential payload — only the
 * `humr.ai/host-pattern` annotation that the controller consumes when
 * extending the cert SAN list and rendering an MITM-only filter chain.
 *
 * See DRAFT-unified-hitl-ux §"L4 → L7 promotion": when the user adds a
 * path-specific egress rule on a host that has no credentialed connection,
 * the host needs MITM so the L7 ext_authz handler can see method/path. The
 * allow-only Secret is the controller's signal to render that chain.
 */
import type * as k8s from "@kubernetes/client-node";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";

const LABEL_OWNER = "humr.ai/owner";
const LABEL_SECRET_TYPE = "humr.ai/secret-type";
const LABEL_MANAGED_BY = "humr.ai/managed-by";
const ANN_HOST_PATTERN = "humr.ai/host-pattern";
const ANN_DISPLAY_NAME = "humr.ai/display-name";

const SECRET_TYPE_ALLOW_ONLY = "allow-only";
const NAME_PREFIX = "humr-allow-";

/**
 * Maps a host string to a K8s name component. K8s metadata.name is RFC 1123:
 * lowercase alphanumeric + hyphen, starting and ending with alphanumeric.
 * Hosts can contain dots; we replace them with hyphens. The hostPattern
 * annotation carries the canonical original host — the name itself is just
 * an addressing key.
 */
function hostToNameSuffix(host: string): string {
  return host
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

function k8sName(ownerSub: string, host: string): string {
  // Owner sub is hashed implicitly via the label selector; the name only
  // needs to be unique per (owner, host). Owner subs from Keycloak are
  // UUID-shaped, but we don't trust that — keep a short prefix off the host.
  const safeOwner = ownerSub.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 8);
  return `${NAME_PREFIX}${safeOwner}-${hostToNameSuffix(host)}`.slice(0, 253);
}

export interface K8sAllowOnlySecretsPort {
  /**
   * Idempotently creates an allow-only Secret for `host` under `ownerSub`.
   * If a Secret with the same `(owner, host)` already exists — credentialed
   * or allow-only — this is a no-op. The credentialed case is correct: the
   * existing chain already MITMs that host, so the path-rule will be
   * enforced without a separate Secret.
   */
  ensure(ownerSub: string, host: string): Promise<void>;
}

export function createK8sAllowOnlySecretsPort(client: K8sClient): K8sAllowOnlySecretsPort {
  return {
    async ensure(ownerSub, host) {
      // Cheap pre-check: does any Secret with this owner+host already exist?
      // Both flavors (credentialed and allow-only) extend the SAN list and
      // give us MITM for the host, which is all the path rule needs.
      const selector = `${LABEL_OWNER}=${ownerSub},${LABEL_MANAGED_BY}=api-server`;
      const existing = await client.listSecrets(selector);
      const alreadyCovers = existing.some(
        (s) => s.metadata?.annotations?.[ANN_HOST_PATTERN] === host,
      );
      if (alreadyCovers) return;

      const body: k8s.V1Secret = {
        metadata: {
          name: k8sName(ownerSub, host),
          labels: {
            [LABEL_OWNER]: ownerSub,
            [LABEL_SECRET_TYPE]: SECRET_TYPE_ALLOW_ONLY,
            [LABEL_MANAGED_BY]: "api-server",
          },
          annotations: {
            [ANN_HOST_PATTERN]: host,
            [ANN_DISPLAY_NAME]: `allow-only:${host}`,
          },
        },
        type: "Opaque",
        // Empty data — controller renders an MITM-only chain with no
        // credential_injector when it sees the secret-type label.
        stringData: {},
      };
      await client.createSecret(body);
    },
  };
}
