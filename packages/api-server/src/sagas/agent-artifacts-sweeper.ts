import { emit, EventType } from "../events.js";
import type { AgentStore } from "../modules/agents/infrastructure/agent-store.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The backstop for a delete the api-server crashed
 * halfway through: agent-scoped rows whose agent no longer exists are cleaned
 * up as the delete would have cleaned them.
 *
 * It refuses to act when the agent store is empty. "No agents at all, but rows
 * that name agents" is not the state this exists for — it is the shape of a
 * store that has not been populated yet, and reaping then destroys an entire
 * install's channel bindings, schedules, keys and shares in one pass. An
 * install that genuinely has no agents loses only a backstop, and only until
 * its next agent exists; the delete path cleans up synchronously either way.
 */

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
    if (live.size === 0) {
      process.stderr.write(
        `[agent-artifacts-sweeper] ${orphans.size} orphan(s) but no agents exist — refusing to reap\n`,
      );
      return;
    }

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
