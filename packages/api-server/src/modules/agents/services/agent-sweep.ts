/**
 * Agent Sweep (#2816): owner-agnostic GC that deletes a Sweepable Agent once it
 * hibernates. Generic successor to the retired sandbox sweeper — it keys off
 * Agent state (the Sweepable annotation + the hibernated condition), never any
 * Invocations table, so anything that marks an agent Sweepable (Invocation
 * targets today, Forks and inherited channel agents later) is reaped by the
 * same loop.
 *
 * A Sweepable agent that goes idle enough to hibernate is deleted instead of
 * lingering. An optional per-agent Lifetime grace (default zero) lets a
 * Sweepable agent stay hibernated for a while before deletion — the knob that
 * later keeps an inherited channel agent warm; an Invocation target sets no
 * grace and dies on hibernate.
 *
 * This is the backstop, not the only reaper: a terminal Invocation deletes its
 * target eagerly. The Sweep catches agents no Invocation reaps (an eager delete
 * that failed, a replica that died mid-delete, or future Sweepable agents with
 * no Invocation at all). Deletion is api-server-only — dropping the Agent
 * ConfigMap cascades pod/gateway/PVC via ownerReferences; no controller change.
 *
 * Multi-replica safe: delete is idempotent, so two replicas reaping the same
 * agent is harmless.
 */

import type { AgentsService } from "api-server-api";
import type { InfraAgent } from "../infrastructure/agent-mappers.js";

export interface AgentSweep {
  /** One idempotent scan — scheduled via the shared periodic-jobs queue
   *  (one execution per period across replicas). */
  tick(): Promise<void>;
}

export interface CreateAgentSweepDeps {
  /** All agents across owners — the scan input. */
  listAgents: () => Promise<InfraAgent[]>;
  /** Owner-scoped agents service, for deleting a swept agent. */
  agentsFor: (owner: string) => AgentsService;
  now?: () => Date;
}

/** Whether a hibernated, Sweepable agent's Lifetime grace has elapsed. A zero
 *  (or absent) Lifetime deletes as soon as it hibernates. A positive Lifetime
 *  needs the hibernation transition time to measure from; if the controller has
 *  not published one yet, hold off until the next tick rather than guess. */
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
