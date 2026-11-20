import type { AgentsService } from "api-server-api";
import type { InfraAgent } from "../infrastructure/agent-mappers.js";

export interface AgentSweep {
  tick(): Promise<void>;
}

/** UNIT_BOUNDARY_DESCRIPTION: who the sweep is in the security log. It deletes through the owner's Agents service, which is what scopes the delete to the owner's Agent, but the delete is the platform's, so the row names the sweep and not the owner. */
export const AGENT_SWEEP_ACTOR = {
  actor: "system:agent-sweep",
  actorKind: "system",
} as const;

export interface CreateAgentSweepDeps {
  listAgents: () => Promise<InfraAgent[]>;
  agentsFor: (owner: string, as: typeof AGENT_SWEEP_ACTOR) => AgentsService;
}

function isSweepDue(agent: InfraAgent, now: Date): boolean {
  if (!agent.sweepable || !agent.hibernated) return false;
  if (agent.lifetimeMs <= 0) return true;
  if (!agent.hibernatedSince) return false;
  return now.getTime() - agent.hibernatedSince.getTime() >= agent.lifetimeMs;
}

export function createAgentSweep(deps: CreateAgentSweepDeps): AgentSweep {
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const agents = await deps.listAgents();
      const at = new Date();
      let reaped = 0;
      for (const agent of agents) {
        if (!isSweepDue(agent, at)) continue;
        if (!agent.owner) continue;
        try {
          await deps.agentsFor(agent.owner, AGENT_SWEEP_ACTOR).delete(agent.id);
          reaped += 1;
        } catch (err) {
          process.stderr.write(
            `[agent-sweep] delete ${agent.id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
      if (reaped > 0)
        process.stderr.write(`[agent-sweep] swept ${reaped} agent(s)\n`);
    } finally {
      running = false;
    }
  }

  return { tick };
}
