import type { Person } from "../people.js";

export type Surface = "api" | "ui" | "cli";

export type CliAnswer = "allows" | "refuses";

export interface SessionDriver {
  signIn(person: Person): Promise<void>;
  expectAskedForTerms(person: Person): Promise<void>;
  readTerms(person: Person): Promise<void>;
  expectTermsShown(person: Person): Promise<void>;
  followSignedOut(person: Person, path: string): Promise<void>;
  expectAt(person: Person, path: string): Promise<void>;
  signInCli(person: Person, answer: CliAnswer): Promise<void>;
  expectCliSignedIn(person: Person, signedIn: boolean): Promise<void>;
}

export interface AgentsDriver {
  lookAt(person: Person): Promise<void>;
  expectListed(person: Person, name: string, listed: boolean): Promise<void>;
  makeFromGeneralist(person: Person, alias: string): Promise<void>;
  remove(person: Person, name: string): Promise<void>;
  make(person: Person, name: string): Promise<void>;
  expectProvider(
    person: Person,
    agentName: string,
    templateId: string,
  ): Promise<void>;
  expectIdle(person: Person, name: string): Promise<void>;
  openSettingsFromAnswer(person: Person, name: string): Promise<void>;
  openOldAddress(person: Person, name: string, section: string): Promise<void>;
  expectSettingsOverChat(
    person: Person,
    name: string,
    section?: string,
  ): Promise<void>;
}

export interface ConnectionsDriver {
  lookAt(person: Person): Promise<void>;
  expectListed(person: Person, name: string, listed: boolean): Promise<void>;
  grant(
    person: Person,
    connectionName: string,
    agentName: string,
  ): Promise<void>;
  expectGrantRefused(person: Person, reason: RegExp): Promise<void>;
  make(
    person: Person,
    name: string,
    host: string,
    forAgent?: string,
  ): Promise<void>;
  remove(person: Person, name: string): Promise<void>;
  replaceSecret(person: Person, name: string): Promise<void>;
  expectHeld(
    person: Person,
    connectionName: string,
    agentName: string,
    held: boolean,
  ): Promise<void>;
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
 * UNIT_BOUNDARY_DESCRIPTION: what a person does and observes in the When and Then steps of examples and journeys, by capability (session, agents, chat, artifacts, connections), independent of the surface they use. Each surface implements every capability its tagged scenarios reach, and the same feature file runs through each surface as its own Playwright project.
 */
export interface Driver {
  readonly surface: Surface;
  readonly session: SessionDriver;
  readonly agents: AgentsDriver;
  readonly chat: ChatDriver;
  readonly artifacts: ArtifactsDriver;
  readonly connections: ConnectionsDriver;
}
