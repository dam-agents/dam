import { randomUUID } from "node:crypto";
import type { EgressRuleSource } from "api-server-api";
import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";

export interface ConnectionRulesSync {
  syncForAgent(input: {
    agentId: string;
    decidedBy: string;
    grants: Map<string, { hosts: readonly EgressHostRule[] }>;
    ownedSourceIds: ReadonlySet<string>;
  }): Promise<void>;

  adoptSources(input: {
    agentId: string;
    fromSources: string[];
    toSource: string;
  }): Promise<void>;
}

export interface EgressHostRule {
  host: string;
  port?: number;
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

      const desiredTriples = new Set<string>();
      for (const [connId, { hosts }] of grants) {
        for (const rule of hosts) {
          desiredTriples.add(
            tripleKey(connId, rule.host, normalizePath(rule.pathPattern)),
          );
        }
      }

      for (const [triple, row] of currentByTriple) {
        if (desiredTriples.has(triple)) continue;
        const connId = row.source.slice(SOURCE_PREFIX.length);
        if (!ownedSourceIds.has(connId)) continue;
        await deps.repo.revoke(row.id);
      }

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
