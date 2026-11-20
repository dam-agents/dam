import type { Persona } from "./people.js";

export interface AgentRecord {
  owner: Persona;
  name: string;
  id: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what one example has made and seen. The names and texts a feature file writes are made unique to the run, so an implementation that special-cases an example's literal values fails, and nothing one example makes is mistaken by another for its own. The evidence it collects is attached to the test when it fails.
 */
export class World {
  readonly run = `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  readonly agents = new Map<string, AgentRecord>();
  readonly evidence: Record<string, unknown>[] = [];

  unique(text: string): string {
    return `${text}-${this.run}`;
  }

  agent(name: string): AgentRecord {
    const record = this.agents.get(name);
    if (record === undefined)
      throw new Error(`no Given step made an agent called "${name}"`);
    return record;
  }

  nameOf(name: string): string {
    return this.agents.get(name)?.name ?? name;
  }

  note(entry: Record<string, unknown>): void {
    this.evidence.push({ at: new Date().toISOString(), ...entry });
  }
}
