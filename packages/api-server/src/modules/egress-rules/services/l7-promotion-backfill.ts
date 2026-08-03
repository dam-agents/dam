/**
 * One-shot startup migration (#2865): moves L7 promotion from the legacy
 * owner-scoped allow-only marker Secrets onto each Agent CR's
 * `spec.l7Hosts`, at per-agent grain.
 *
 * The desired host set is derived from the rules table — the source of
 * truth the markers shadowed — so markers for since-revoked rules or
 * since-deleted agents simply age out. Markers are deleted only after
 * every Agent patch succeeded; until then the controller still renders
 * them (it consumes both signals), so rules stay enforced across a
 * partial run. Idempotent: a re-run converges to the same spec and finds
 * no markers left.
 */
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";
import type { AgentL7HostsPort } from "../infrastructure/k8s-agent-l7-hosts-port.js";
import { promotedHosts, type PromotionRule } from "../domain/l7-promotion.js";

const LEGACY_MARKER_SELECTOR =
  "agent-platform.ai/secret-type=allow-only,agent-platform.ai/managed-by=api-server";

export interface BackfillL7PromotionsDeps {
  repo: EgressRulesRepository;
  l7Hosts: AgentL7HostsPort;
  k8sClient: K8sClient;
  log: (message: string) => void;
}

export async function backfillL7Promotions(
  deps: BackfillL7PromotionsDeps,
): Promise<{ failed: number }> {
  const rules = await deps.repo.listActiveForPromotionScan();
  const byAgent = new Map<string, PromotionRule[]>();
  for (const r of rules) {
    const list = byAgent.get(r.agentId) ?? [];
    list.push(r);
    byAgent.set(r.agentId, list);
  }

  // Same `promotedHosts` definition and `set` (replace) semantics as the
  // live reconverge path, so the backfill and every later rule write agree
  // on the value and never fight each other into a gateway roll. An agent
  // with no promoted host is not touched here (it has none to migrate);
  // the live path clears it if a rule is later revoked.
  let failed = 0;
  for (const [agentId, agentRules] of byAgent) {
    try {
      await deps.l7Hosts.set(agentId, promotedHosts(agentRules));
    } catch (err) {
      failed++;
      deps.log(`patching agent ${agentId} failed: ${String(err)}`);
    }
  }

  // Legacy markers go only once every live agent carries its promotions —
  // a kept marker is harmless (the controller renders both signals), a
  // prematurely deleted one silently unenforces a rule (#2322).
  if (failed > 0) return { failed };

  const markers = await deps.k8sClient.listSecrets(LEGACY_MARKER_SELECTOR);
  let deleted = 0;
  for (const marker of markers) {
    const name = marker.metadata?.name;
    if (!name) continue;
    try {
      await deps.k8sClient.deleteSecret(name);
      deleted++;
    } catch (err) {
      failed++;
      deps.log(`deleting legacy marker ${name} failed: ${String(err)}`);
    }
  }
  if (byAgent.size > 0 || deleted > 0) {
    deps.log(
      `backfilled ${byAgent.size} agent(s), removed ${deleted}/${markers.length} legacy marker Secret(s)`,
    );
  }
  return { failed };
}
