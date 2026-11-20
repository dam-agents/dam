import type { Person } from "../people.js";

export type Surface = "api" | "ui" | "cli";

export interface SessionDriver {
  signIn(person: Person): Promise<void>;
}

export interface AgentsDriver {
  lookAt(person: Person): Promise<void>;
  expectListed(person: Person, name: string, listed: boolean): Promise<void>;
  makeFromGeneralist(person: Person, alias: string): Promise<void>;
  remove(person: Person, name: string): Promise<void>;
}

export interface ChatDriver {
  send(person: Person, name: string, text: string): Promise<void>;
  expectAnswer(
    person: Person,
    name: string,
    text: string | undefined,
  ): Promise<void>;
}

export interface ArtifactsDriver {
  expectInLibrary(person: Person, title: string): Promise<void>;
  expectPublishedBy(
    person: Person,
    title: string,
    agentName: string,
  ): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a person does and observes in the When and Then steps of examples and journeys, by capability (session, agents, chat, artifacts), independent of the surface they use. Each surface implements every capability its tagged scenarios reach, and the same feature file runs through each surface as its own Playwright project.
 */
export interface Driver {
  readonly surface: Surface;
  readonly session: SessionDriver;
  readonly agents: AgentsDriver;
  readonly chat: ChatDriver;
  readonly artifacts: ArtifactsDriver;
}
