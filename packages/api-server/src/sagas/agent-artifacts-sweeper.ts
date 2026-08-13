import type { K8sClient } from "../modules/agents/infrastructure/k8s.js";
import { AGENTS_PLURAL } from "../modules/agents/infrastructure/labels.js";

export interface AgentArtifactsSweeper {
  tick(): Promise<void>;
}

export interface CreateAgentArtifactsSweeperDeps {
  k8s: K8sClient;
  sources: ReadonlyArray<{
    name: string;
    listAgentIds: () => Promise<string[]>;
    cleanup: (agentId: string) => Promise<void>;
  }>;
  batchSize: number;
}

export function createAgentArtifactsSweeper(
  deps: CreateAgentArtifactsSweeperDeps,
): AgentArtifactsSweeper {
  async function tick(): Promise<void> {
    const agents = await deps.k8s.listCustomObjects(AGENTS_PLURAL);
    const live = new Set(
      agents
        .map((a) => a.metadata?.name)
        .filter((n): n is string => Boolean(n)),
    );

    const orphans = new Set<string>();
    for (const source of deps.sources) {
      const ids = await source.listAgentIds();
      for (const id of ids) {
        if (!live.has(id)) orphans.add(id);
      }
    }

    if (orphans.size === 0) return;

    const toDelete = [...orphans].slice(0, deps.batchSize);
    for (const agentId of toDelete) {
      for (const source of deps.sources) {
        try {
          await source.cleanup(agentId);
        } catch (err) {
          process.stderr.write(
            `[agent-artifacts-sweeper] ${source.name} cleanup failed for ${agentId}: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
    }
    process.stderr.write(
      `[agent-artifacts-sweeper] reaped ${toDelete.length} orphan(s) (${orphans.size} known)\n`,
    );
  }

  return { tick };
}
