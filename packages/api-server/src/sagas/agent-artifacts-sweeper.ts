import { emit, EventType } from "../events.js";
import type { K8sClient } from "../modules/agents/infrastructure/k8s.js";
import { AGENTS_PLURAL } from "../modules/agents/infrastructure/labels.js";

export interface AgentArtifactsSweeper {
  tick(): Promise<void>;
}

export interface AgentOrphanDetector {
  name: string;
  listAgentIds: () => Promise<string[]>;
}

export interface AgentCleanupSource extends AgentOrphanDetector {
  cleanup: (agentId: string) => Promise<void>;
}

export interface CreateAgentArtifactsSweeperDeps {
  k8s: K8sClient;
  sources: ReadonlyArray<AgentCleanupSource>;
  detectors: ReadonlyArray<AgentOrphanDetector>;
  resolveOwner: (agentId: string) => Promise<string | null>;
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
    for (const source of [...deps.sources, ...deps.detectors]) {
      const ids = await source.listAgentIds();
      for (const id of ids) {
        if (!live.has(id)) orphans.add(id);
      }
    }

    if (orphans.size === 0) return;

    let reaped = 0;
    for (const agentId of [...orphans].slice(0, deps.batchSize)) {
      if (await deps.k8s.getCustomObject(AGENTS_PLURAL, agentId)) continue;
      reaped++;
      const ownerSub = await deps.resolveOwner(agentId);
      for (const source of deps.sources) {
        try {
          await source.cleanup(agentId);
        } catch (err) {
          process.stderr.write(
            `[agent-artifacts-sweeper] ${source.name} cleanup failed for ${agentId}: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
      emit({
        type: EventType.AgentDeleted,
        agentId,
        ...(ownerSub ? { ownerSub } : {}),
      });
    }
    if (reaped === 0) return;
    process.stderr.write(
      `[agent-artifacts-sweeper] reaped ${reaped} orphan(s) (${orphans.size} known)\n`,
    );
  }

  return { tick };
}
