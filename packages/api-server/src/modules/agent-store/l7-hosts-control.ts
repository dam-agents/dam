import { and, eq, inArray, type Db } from "db";
import { controlAgentL7Hosts, controlAgents } from "db";
import type { AgentL7HostsPort } from "../egress-rules/infrastructure/k8s-agent-l7-hosts-port.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the L7 host projection over the rows, which is what
 * the custom resource's `spec.l7Hosts` becomes after the switch.
 *
 * Promotions write these rows and the controller renders them, so the write is a
 * set difference against the rows rather than a read-modify-write of a resource.
 * The row trigger advances the definition's generation from the change, so a
 * promotion reaches the machine exactly as a spec patch did. An Agent whose row
 * is gone drops the write: there is nothing left to promote to.
 */
export function createControlAgentL7HostsPort(db: Db): AgentL7HostsPort {
  return {
    async set(agentId, hosts) {
      const desired = [...new Set(hosts)].sort();
      const existing = await db
        .select({ id: controlAgents.id })
        .from(controlAgents)
        .where(eq(controlAgents.id, agentId))
        .limit(1);
      if (existing.length === 0) return;
      await db.transaction(async (tx) => {
        const current = await tx
          .select({ host: controlAgentL7Hosts.host })
          .from(controlAgentL7Hosts)
          .where(eq(controlAgentL7Hosts.agentId, agentId));
        const currentSet = new Set(current.map((row) => row.host));
        const nextSet = new Set(desired);
        const removed = [...currentSet].filter((host) => !nextSet.has(host));
        const added = desired.filter((host) => !currentSet.has(host));
        if (removed.length > 0)
          await tx
            .delete(controlAgentL7Hosts)
            .where(
              and(
                eq(controlAgentL7Hosts.agentId, agentId),
                inArray(controlAgentL7Hosts.host, removed),
              ),
            );
        if (added.length > 0)
          await tx
            .insert(controlAgentL7Hosts)
            .values(added.map((host) => ({ agentId, host })))
            .onConflictDoNothing();
      });
    },
  };
}
