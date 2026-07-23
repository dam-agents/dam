/**
 * Projects L7 promotion onto the Agent custom resource (#2865): when a
 * path/method/port egress rule exists for an agent, its host must be on the
 * gateway's TLS-terminating (L7) chain or the rule is unenforceable over
 * HTTPS — the L4 catch-all sees only SNI. `spec.l7Hosts` is the per-agent
 * signal the controller renders chains and the leaf SAN list from.
 *
 * This replaces the owner-scoped allow-only marker Secrets, whose
 * owner-wide grain reshaped (and rolled) every sibling gateway on a
 * single agent's rule (#2867) and never reached fork gateways (#2866).
 * Promotion is written even when a credentialed connection already covers
 * the host: the controller dedupes chains by host anyway, and the rule
 * stays enforced if that connection is later revoked.
 *
 * `set` REPLACES the list with exactly the caller's set, so it is the
 * whole demotion story too: callers recompute the agent's desired hosts
 * from its active rules after any mutation, and `spec.l7Hosts` stays a
 * pure projection of the rules table — a revoked rule's host drops off on
 * the next reconverge instead of ratcheting forever.
 */
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import { AGENTS_PLURAL } from "../../agents/infrastructure/labels.js";

export interface AgentL7HostsPort {
  /**
   * Sets the agent's `spec.l7Hosts` to exactly `hosts` (deduped, sorted).
   * A missing Agent CR is a no-op (rule rows can outlive the agent). No
   * patch when the CR already carries that exact set, so an unchanged
   * reconverge never rolls the gateway. Throws when the write does not
   * stick, so callers never mistake a dropped promotion for success.
   */
  set(agentId: string, hosts: readonly string[]): Promise<void>;
}

/** Concurrent `set`s race read-modify-write; resourceVersion turns the
 *  race into a retriable conflict instead of a lost update. */
const PATCH_ATTEMPTS = 3;

function sameSet(a: Set<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((h) => a.has(h));
}

export function createAgentL7HostsPort(client: K8sClient): AgentL7HostsPort {
  return {
    async set(agentId, hosts) {
      const desired = [...new Set(hosts)].sort();
      let lastErr: unknown;
      for (let attempt = 0; attempt < PATCH_ATTEMPTS; attempt++) {
        const agent = await client.getCustomObject(AGENTS_PLURAL, agentId);
        if (!agent) return;
        const spec = (agent.spec ?? {}) as { l7Hosts?: string[] };
        const current = new Set(spec.l7Hosts ?? []);
        if (sameSet(current, desired)) return;
        try {
          // The resourceVersion in the merge-patch body makes the write
          // conditional: a concurrent write (rule create racing an inbox
          // verdict or the startup backfill) surfaces as a conflict and
          // retries with a fresh read instead of clobbering — a lost host
          // shows the rule as active while its HTTPS half is unenforced
          // (#2322 class).
          const result = await client.patchCustomObject(
            AGENTS_PLURAL,
            agentId,
            {
              metadata: { resourceVersion: agent.metadata?.resourceVersion },
              spec: { l7Hosts: desired },
            },
          );
          // The patch response is the resulting object. A live CRD older
          // than Agent schema gen 5 silently PRUNES the unknown field and
          // still returns 200 — verify the hosts actually persisted so a
          // pruned write fails loud (the backfill keeps the legacy
          // markers and retries; a rule write reports the error) instead
          // of leaving the rule silently unenforced.
          const written = new Set(
            ((result.spec ?? {}) as { l7Hosts?: string[] }).l7Hosts ?? [],
          );
          if (!sameSet(written, desired)) {
            throw new Error(
              `spec.l7Hosts write for agent ${agentId} did not persist — ` +
                `is the agents CRD older than schema generation 5?`,
            );
          }
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    },
  };
}
