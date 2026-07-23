/**
 * One-time boot sweep: delete the drained legacy credential Secrets
 * (`platform-cred-*`) that the secrets→connections migration (#1273)
 * deliberately left in place. Deleting a Secret while a gateway pod was
 * still mid-roll on a StatefulSet revision that mounted it would wedge the
 * pod in `ContainerCreating` (FailedMount), so deletion was deferred to
 * #2198; nothing has granted a legacy secret since the drain, so no gateway
 * revision references them anymore and deletion at boot is safe.
 *
 * The summary line is the field confirmation of #2198's drain gate on
 * installs without kubectl access — it is emitted even on a clean pass.
 * Removed by the #2198 follow-up once every install logs a clean pass.
 *
 * Safety valve: a Secret still granted by an agent (`spec.grantedSecretIds`)
 * is never deleted — that signals an install that skipped every
 * migration-era release (≥ #2337) and needs a human, not a delete.
 */
import type * as k8s from "@kubernetes/client-node";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import {
  AGENTS_PLURAL,
  LABEL_MANAGED_BY,
  LABEL_SECRET_TYPE,
  MANAGED_BY_API_SERVER,
} from "../../agents/infrastructure/labels.js";

// Legacy secrets carry this name prefix; it partitions them from every other
// api-server-managed Secret (connection `platform-secret-*`, allow-only
// `platform-allow-*`, registry-pull `<agentId>-registry-pull`).
const LEGACY_NAME_PREFIX = "platform-cred-";

export interface LegacySecretSweepResult {
  deleted: number;
  skipped: number;
  failed: number;
}

export interface LegacySecretSweepDeps {
  k8sClient: K8sClient;
  log: (message: string) => void;
  logError: (message: string) => void;
}

// Same semantics as the deleted migration's legacy-secret-reader: an absent
// `secret-type` label reads as `generic`, which is legacy.
function isLegacyCredentialSecret(s: k8s.V1Secret): boolean {
  const name = s.metadata?.name ?? "";
  if (!name.startsWith(LEGACY_NAME_PREFIX)) return false;
  return s.metadata?.labels?.[LABEL_SECRET_TYPE] !== "connection";
}

/** Union of every agent's `spec.grantedSecretIds`, keyed the way the
 *  controller's `filterByGrants` keys legacy secrets: the id suffix after
 *  `platform-cred-`. */
async function grantedLegacySecretIds(
  k8sClient: K8sClient,
): Promise<Set<string>> {
  const agents = await k8sClient.listCustomObjects(AGENTS_PLURAL);
  const ids = new Set<string>();
  for (const agent of agents) {
    const spec = (agent.spec ?? {}) as { grantedSecretIds?: unknown };
    if (!Array.isArray(spec.grantedSecretIds)) continue;
    for (const id of spec.grantedSecretIds) {
      if (typeof id === "string") ids.add(id);
    }
  }
  return ids;
}

export async function sweepLegacyCredentialSecrets(
  deps: LegacySecretSweepDeps,
): Promise<LegacySecretSweepResult> {
  const { k8sClient, log, logError } = deps;

  const all = await k8sClient.listSecrets(
    `${LABEL_MANAGED_BY}=${MANAGED_BY_API_SERVER}`,
  );
  const legacy = all.filter(isLegacyCredentialSecret);

  const result: LegacySecretSweepResult = { deleted: 0, skipped: 0, failed: 0 };
  if (legacy.length > 0) {
    const granted = await grantedLegacySecretIds(k8sClient);
    for (const secret of legacy) {
      const name = secret.metadata?.name ?? "";
      if (granted.has(name.slice(LEGACY_NAME_PREFIX.length))) {
        result.skipped++;
        logError(
          `${name} is still granted by an agent; left in place — this ` +
            `install never ran a migration-era release (#1273/#2337) and ` +
            `needs manual attention`,
        );
        continue;
      }
      try {
        await k8sClient.deleteSecret(name);
        result.deleted++;
        log(`deleted drained legacy Secret ${name}`);
      } catch (err) {
        result.failed++;
        logError(`failed to delete ${name}: ${String(err)}`);
      }
    }
  }

  log(
    `deleted ${result.deleted}, skipped ${result.skipped}, ` +
      `failed ${result.failed}`,
  );
  return result;
}
