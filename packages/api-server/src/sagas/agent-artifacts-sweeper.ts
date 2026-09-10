import { emit, EventType } from "../events.js";
import type { AgentStore } from "../modules/agents/infrastructure/agent-store.js";

export interface AgentArtifactsSweeper {
  tick(): Promise<void>;
}

export interface AgentCleanupSource {
  name: string;
  listAgentIds: () => Promise<string[]>;
  cleanup: (agentId: string) => Promise<void>;
}

export interface CreateAgentArtifactsSweeperDeps {
  agentStore: AgentStore;
  sources: ReadonlyArray<AgentCleanupSource>;
  resolveOwner: (agentId: string) => Promise<string | null>;
  batchSize: number;
}

export function createAgentArtifactsSweeper(
  deps: CreateAgentArtifactsSweeperDeps,
): AgentArtifactsSweeper {
  async function tick(): Promise<void> {
    const live = new Set((await deps.agentStore.list()).map((a) => a.id));

    const orphans = new Set<string>();
    for (const source of deps.sources) {
      const ids = await source.listAgentIds();
      for (const id of ids) {
        if (!live.has(id)) orphans.add(id);
      }
    }

    if (orphans.size === 0) return;

    let reaped = 0;
    for (const agentId of [...orphans].slice(0, deps.batchSize)) {
      if (await deps.agentStore.get(agentId)) continue;
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
