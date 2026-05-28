import type { Connection, Contribution } from "api-server-api";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";

export interface FanOutPort {
  setConnectionGrants(agentId: string, connectionIds: string[]): Promise<void>;
  bumpSecretsRev(agentId: string): Promise<void>;
  syncEgressHosts(input: {
    agentId: string;
    decidedBy: string;
    grants: Map<string, { hosts: { host: string; pathPattern?: string }[] }>;
    ownedSourceIds: ReadonlySet<string>;
  }): Promise<void>;
}

export interface ContributionFanOut {
  apply(input: {
    agentId: string;
    ownerId: string;
    grantedConnections: Connection[];
    allOwnerConnectionIds: ReadonlySet<string>;
  }): Promise<void>;
}

export function createContributionFanOut(deps: {
  port: FanOutPort;
  runtimeMutator: RuntimeMutator;
}): ContributionFanOut {
  return {
    async apply({
      agentId,
      ownerId,
      grantedConnections,
      allOwnerConnectionIds,
    }) {
      const allContribs: Contribution[] = grantedConnections.flatMap(
        (c) => c.contributions,
      );

      await deps.port.setConnectionGrants(
        agentId,
        grantedConnections.map((c) => c.id),
      );

      const egressGrants = new Map<
        string,
        { hosts: { host: string; pathPattern?: string }[] }
      >();
      for (const conn of grantedConnections) {
        const hosts = conn.contributions
          .filter(
            (
              c,
            ): c is Extract<
              Contribution,
              { kind: "egress-allow" | "egress-inject" }
            > => c.kind === "egress-allow" || c.kind === "egress-inject",
          )
          .map((c) => ({
            host: c.host,
            ...(c.pathPattern ? { pathPattern: c.pathPattern } : {}),
          }));
        if (hosts.length > 0) {
          egressGrants.set(conn.id, { hosts });
        }
      }
      await deps.port.syncEgressHosts({
        agentId,
        decidedBy: ownerId,
        grants: egressGrants,
        ownedSourceIds: allOwnerConnectionIds,
      });

      const hasEnvContribs = allContribs.some((c) => c.kind === "env");
      if (hasEnvContribs) {
        await deps.port.bumpSecretsRev(agentId);
      }

      await deps.runtimeMutator.bump(agentId, []);
      await deps.runtimeMutator.enqueueAfterCommit(agentId);
    },
  };
}
