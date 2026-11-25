import type { HeldKey, Outcome } from "./keys.js";
import type { Persona } from "./people.js";

export interface ConnectionRecord {
  owner: Persona;
  name: string;
  id: string;
  host?: string;
  secret?: string;
  envName?: string;
}

/** UNIT_BOUNDARY_DESCRIPTION: the variable a custom-header connection of the examples sets: one per connection name, so two connections never write one variable. */
export function envNameOf(name: string): string {
  return `ACCEPTANCE_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/** UNIT_BOUNDARY_DESCRIPTION: the inputs of a custom-header connection the examples make, through any surface: its secret is unique to the run, and it sets a variable of its own unless the example says it sets none. */
export function customHeader(
  world: World,
  name: string,
  host: string,
  {
    variable = true,
    key = "acceptance-secret",
    envName = envNameOf(name),
  } = {},
) {
  return {
    templateId: "custom-header",
    name: world.unique(name),
    authKind: "header" as const,
    value: world.unique(key),
    host,
    headerName: "x-api-key",
    valueFormat: "{value}",
    ...(variable ? { envName } : {}),
  };
}

export interface SessionRecord {
  owner: Persona;
  agent: string;
  title: string;
  id: string;
}

export interface AgentRecord {
  owner: Persona;
  name: string;
  id: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what one example has made and seen. The names and texts a feature file writes are made unique to the run, so an implementation that special-cases an example's literal values fails, and nothing one example makes is mistaken by another for its own. The evidence it collects is attached to the test when it fails, and what it made beyond the warm agents is deleted when it ends.
 */
export class World {
  readonly run = `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  readonly agents = new Map<string, AgentRecord>();
  readonly connections = new Map<string, ConnectionRecord>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly made: {
    kind: "agent" | "connection" | "session";
    owner: Persona;
    id: string;
    agentId?: string;
  }[] = [];
  readonly closers: (() => void)[] = [];
  readonly keys = new Map<string, HeldKey>();
  /** UNIT_BOUNDARY_DESCRIPTION: the ids of browser tabs an example closed, by agent and title, so a later step can name a tab that is gone. */
  readonly browserTabs = new Map<string, string>();
  outcome: Outcome | undefined;
  /** UNIT_BOUNDARY_DESCRIPTION: the requests an agent holds for its owner's verdict, by agent: the approval that waits and what each request got back once answered. */
  readonly held = new Map<
    string,
    { approvalId: string; url: string; results: Promise<number>[] }
  >();
  /** UNIT_BOUNDARY_DESCRIPTION: what puts a warm agent back as the example found it, run newest first when the example ends. */
  readonly undo: (() => Promise<unknown>)[] = [];
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

  connection(name: string): ConnectionRecord {
    const record = this.connections.get(name);
    if (record === undefined)
      throw new Error(`no Given step made a connection called "${name}"`);
    return record;
  }

  session(text: string): SessionRecord {
    const record = this.sessions.get(text);
    if (record === undefined)
      throw new Error(`no step opened a session with "${text}"`);
    return record;
  }

  /** UNIT_BOUNDARY_DESCRIPTION: records a Session a person opened with a first message, so the example deletes it when it ends. */
  opened(owner: Persona, agent: string, text: string, id: string): void {
    const record = { owner, agent, title: this.unique(text), id };
    this.sessions.set(text, record);
    this.made.push({
      kind: "session",
      owner,
      id,
      agentId: this.agent(agent).id,
    });
    this.note({ step: "session opened", ...record });
  }

  nameOf(name: string): string {
    return this.agents.get(name)?.name ?? name;
  }

  note(entry: Record<string, unknown>): void {
    this.evidence.push({ at: new Date().toISOString(), ...entry });
  }
}
