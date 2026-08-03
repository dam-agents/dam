import { randomUUID } from "node:crypto";
import type { EgressRuleSource } from "api-server-api";
import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";

/**
 * Reconciles `egress_rules` with the agent's currently-granted connections.
 * `setAgentConnections` calls this with its full desired grant set on every
 * change. Each grant is a connection id paired with the (host, pathPattern)
 * rules the connection covers — a single-host credential contributes one rule;
 * app connections may contribute several (e.g. Google Workspace; Gmail with
 * both modern and legacy hosts).
 *
 * Lifecycle (DRAFT-unified-hitl-ux §"Single rules table"):
 *   - Granted (connId, host, pathPattern) not yet in egress_rules → insert
 *     `(host, *, pathPattern, allow, source=connection:<connId>)`. Skip if
 *     a `manual` or `inbox` rule already covers the host.
 *   - Active row whose (connId, host, pathPattern) is no longer in the
 *     grant set → revoke. User-promoted rows (source=manual) flip out of
 *     this scan because `listConnectionDerivedForAgent` only returns
 *     `connection:%`.
 *
 * Callers pass `ownedSourceIds` to scope the revoke pass to the rules they're
 * responsible for, so a sync for one set of connections never revokes rows
 * sourced from another.
 *
 * Idempotent — calling with the same input twice is a no-op. Multiple rows
 * may share the same `source` (one connection covering many hosts); the
 * `(connId, host, pathPattern)` triple is the deduplication key.
 */
export interface ConnectionRulesSync {
  syncForAgent(input: {
    agentId: string;
    decidedBy: string;
    /** All currently granted connections, keyed by connection id, value is
     *  the list of (host, pathPattern) rules the connection targets. */
    grants: Map<string, { hosts: readonly EgressHostRule[] }>;
    /**
     * Source IDs the caller is responsible for. Rules whose extracted
     * connection-id is NOT in this set are left untouched, so each module
     * (secrets / app-connections) only manages its own rows. Pass the
     * caller's full set of owned IDs (granted or not) — IDs in `grants`
     * are automatically considered owned regardless.
     */
    ownedSourceIds: ReadonlySet<string>;
  }): Promise<void>;

  /** Transfer ownership of an agent's active egress rows from the legacy
   *  secret sources to the migrated connection's source, in place. Used by
   *  the secrets→connections migration: a plain revoke-then-insert would
   *  briefly leave the host with no active allow row, so this relabels the
   *  existing row instead — no coverage gap, and the connection then owns the
   *  row so a later revoke closes egress correctly. */
  adoptSources(input: {
    agentId: string;
    fromSources: string[];
    toSource: string;
  }): Promise<void>;
}

/**
 * Egress rule target — host plus optional path-prefix discriminator.
 * Multiple connections can share a host as long as their path patterns
 * differ (e.g. Google Drive at `www.googleapis.com/drive/*` and Google
 * Calendar at `www.googleapis.com/calendar/*`). Plain hostnames promote
 * to `pathPattern: "*"` automatically — the legacy "match every path"
 * shape.
 */
export interface EgressHostRule {
  host: string;
  port?: number; // transparency only; ext-authz matches host
  pathPattern?: string;
}

export interface CreateConnectionRulesSyncDeps {
  repo: EgressRulesRepository;
}

const SOURCE_PREFIX = "connection:";

function tripleKey(connId: string, host: string, pathPattern: string): string {
  return `${connId} ${host} ${pathPattern}`;
}

function normalizePath(p: string | undefined | null): string {
  return p && p.length > 0 ? p : "*";
}

export function createConnectionRulesSync(
  deps: CreateConnectionRulesSyncDeps,
): ConnectionRulesSync {
  return {
    async adoptSources({ agentId, fromSources, toSource }) {
      await deps.repo.reassignActiveSource(
        agentId,
        fromSources,
        toSource as EgressRuleSource,
      );
    },

    async syncForAgent({ agentId, decidedBy, grants, ownedSourceIds }) {
      const current = await deps.repo.listConnectionDerivedForAgent(agentId);
      // Index existing rows by (connId, host, pathPattern). A connection
      // can target multiple (host, pathPattern) tuples (e.g. Gmail at the
      // modern host plus `www.googleapis.com/gmail/*`), so the triple —
      // not a (connId, host) pair — is the dedup key.
      const currentByTriple = new Map<string, (typeof current)[number]>();
      for (const row of current) {
        const connId = row.source.startsWith(SOURCE_PREFIX)
          ? row.source.slice(SOURCE_PREFIX.length)
          : null;
        if (!connId) continue;
        currentByTriple.set(
          tripleKey(connId, row.host, normalizePath(row.pathPattern)),
          row,
        );
      }

      // Build the desired (connId, host, pathPattern) triple set.
      const desiredTriples = new Set<string>();
      for (const [connId, { hosts }] of grants) {
        for (const rule of hosts) {
          desiredTriples.add(
            tripleKey(connId, rule.host, normalizePath(rule.pathPattern)),
          );
        }
      }

      // Revoke rows whose triple is no longer desired AND whose connId is
      // owned by this caller. Rows from a sibling module (secrets when
      // app-connections is syncing, and vice versa) stay untouched.
      for (const [triple, row] of currentByTriple) {
        if (desiredTriples.has(triple)) continue;
        const connId = row.source.slice(SOURCE_PREFIX.length);
        if (!ownedSourceIds.has(connId)) continue;
        await deps.repo.revoke(row.id);
      }

      // Insert rows for newly-granted triples, skipping when a user-owned
      // (manual/inbox) rule already covers the host. When a `preset:*`
      // row exists for the same lookup key we *promote* it to this
      // connection's source instead of skipping — a user-toggled grant
      // is more specific intent than a bulk preset, and without promotion
      // the next preset switch would silently take the host down even
      // though the user still has the connection granted.
      for (const [connId, { hosts }] of grants) {
        const source = `${SOURCE_PREFIX}${connId}` as const;
        for (const rule of hosts) {
          const pathPattern = normalizePath(rule.pathPattern);
          if (currentByTriple.has(tripleKey(connId, rule.host, pathPattern)))
            continue;
          if (await deps.repo.hasUserOwnedRuleForHost(agentId, rule.host))
            continue;
          await deps.repo.insertOrPromoteFromPreset({
            id: randomUUID(),
            agentId,
            host: rule.host,
            ...(rule.port ? { port: rule.port } : {}),
            method: "*",
            pathPattern,
            verdict: "allow",
            decidedBy,
            source,
          });
        }
      }
    },
  };
}
