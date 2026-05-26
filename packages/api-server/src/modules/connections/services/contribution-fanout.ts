import type { Db } from "db";
import type { Connection, Contribution } from "api-server-api";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";

/**
 * Routes Contribution kinds to their delivery rails (ADR-051 §"Contribution
 * fan-out"). Every grant/revoke runs through here.
 *
 * Three rails:
 *   - `env`         → bump `secrets-rev` annotation on the agent CM. ADR-040
 *                     mechanism preserved; controller's existing reconciler
 *                     re-renders envs at the next pod start.
 *   - `egress-host` → upsert/sweep rows on `egress_rules`. Live read by
 *                     Envoy ext_authz; no pod involvement.
 *   - file / mcp-entry / skill-ref → runtime channel. Bump the agent's
 *                     version, upsert the outbox row, enqueue. The
 *                     state-builder picks up the per-agent contribution set
 *                     by joining connection_grants → connections.
 *
 * The Connections service supplies just (agentId, grantedConnections); this
 * helper handles all three rails uniformly.
 */
export interface FanOutPort {
  setConnectionGrants(agentId: string, connectionIds: string[]): Promise<void>;
  bumpSecretsRev(agentId: string): Promise<void>;
  syncEgressHosts(input: {
    agentId: string;
    decidedBy: string;
    grants: Map<string, { hosts: { host: string; pathPattern?: string }[] }>;
    /** Connection IDs the user owns — lets the sync touch only this
     *  caller's rows without disturbing other rule sources. */
    ownedSourceIds: ReadonlySet<string>;
  }): Promise<void>;
}

export interface ContributionFanOut {
  /**
   * Called by the Connections service after every grant/revoke change.
   * Computes which contributions are now active for the agent, fans out
   * per kind in one Postgres transaction, then enqueues the runtime-channel
   * dispatch.
   */
  apply(input: {
    agentId: string;
    ownerId: string;
    grantedConnections: Connection[];
    allOwnerConnectionIds: ReadonlySet<string>;
  }): Promise<void>;
}

export function createContributionFanOut(deps: {
  db: Db;
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

      // egress-host rail — collect per granted connection, sync.
      const egressGrants = new Map<
        string,
        { hosts: { host: string; pathPattern?: string }[] }
      >();
      for (const conn of grantedConnections) {
        const hosts = conn.contributions
          .filter(
            (c): c is Extract<Contribution, { kind: "egress-host" }> =>
              c.kind === "egress-host",
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

      // env rail — bump secrets-rev so controller re-renders envs at the
      // next pod start. We bump unconditionally on any contribution change;
      // cheap, and avoids fragile diffing.
      const hasEnvContribs = allContribs.some((c) => c.kind === "env");
      if (hasEnvContribs) {
        await deps.port.bumpSecretsRev(agentId);
      }

      // runtime-channel rail — anything that's not env / egress-host rides
      // here. We don't dispatch the contribution list directly; the
      // state-builder reads connection_grants on each apply. We just bump
      // the version + enqueue so the worker pulls a fresh snapshot.
      const hasRuntimeChannelContribs = allContribs.some(
        (c) =>
          c.kind === "file" || c.kind === "mcp-entry" || c.kind === "skill-ref",
      );
      if (hasRuntimeChannelContribs || hasEnvContribs) {
        // We bump for env-only changes too — they don't ride the channel,
        // but the runtime-state-outbox row's version is the cross-rail
        // synchronizer; agents re-reading on hello see a fresh snapshot.
        await deps.db.transaction(async (tx) => {
          await deps.runtimeMutator.commitInTx(tx as unknown as Db, agentId);
        });
        await deps.runtimeMutator.enqueueAfterCommit(agentId);
      }
    },
  };
}
