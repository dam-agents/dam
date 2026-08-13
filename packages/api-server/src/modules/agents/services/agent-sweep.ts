import type { AgentsService } from "api-server-api";
import type { InfraAgent } from "../infrastructure/agent-mappers.js";

export interface AgentSweep {
  tick(): Promise<void>;
}

export interface CreateAgentSweepDeps {
  listAgents: () => Promise<InfraAgent[]>;
  agentsFor: (owner: string) => AgentsService;
  now?: () => Date;
}

export function isSweepDue(agent: InfraAgent, now: Date): boolean {
  if (!agent.sweepable || !agent.hibernated) return false;
  if (agent.lifetimeMs <= 0) return true;
  if (!agent.hibernatedSince) return false;
  return now.getTime() - agent.hibernatedSince.getTime() >= agent.lifetimeMs;
}

export function createAgentSweep(deps: CreateAgentSweepDeps): AgentSweep {
  const now = deps.now ?? (() => new Date());
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const agents = await deps.listAgents();
      const at = now();
      let reaped = 0;
      for (const agent of agents) {
        if (!isSweepDue(agent, at)) continue;
        if (!agent.owner) continue;
        try {
          await deps.agentsFor(agent.owner).delete(agent.id);
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
