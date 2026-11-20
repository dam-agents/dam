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
  send(
    person: Person,
    name: string,
    text: string,
    verbatim?: boolean,
  ): Promise<void>;
  expectAnswerWithout(
    person: Person,
    name: string,
    text: string,
  ): Promise<void>;
  expectAnswer(
    person: Person,
    name: string,
    text: string | undefined,
  ): Promise<void>;
}

export interface EnvironmentDriver {
  set(
    person: Person,
    agentName: string,
    name: string,
    value: string,
  ): Promise<void>;
  remove(person: Person, agentName: string, name: string): Promise<void>;
  expectShown(
    person: Person,
    agentName: string,
    name: string,
    value: string,
  ): Promise<void>;
}

/** UNIT_BOUNDARY_DESCRIPTION: a request an agent makes, as an approval names it: method, host and path. */
export interface EgressRequest {
  method: string;
  host: string;
  path: string;
}

export interface EgressDriver {
  allow(
    person: Person,
    agentName: string,
    method: string,
    host: string,
    pathPattern: string,
  ): Promise<void>;
  expectRule(
    person: Person,
    agentName: string,
    rule: {
      method: string;
      host: string;
      pathPattern: string;
      verdict: string;
    },
    present: boolean,
  ): Promise<void>;
  expectWaiting(
    person: Person,
    agentName: string,
    request: EgressRequest | undefined,
  ): Promise<void>;
  answer(
    person: Person,
    agentName: string,
    verdict: "once" | "always",
  ): Promise<void>;
  openChat(person: Person, agentName: string): Promise<void>;
  expectWaitingInChat(
    person: Person,
    agentName: string,
    request: EgressRequest,
  ): Promise<void>;
  answerOnceInChat(person: Person, agentName: string): Promise<void>;
}

export interface AssistantDriver {
  switchTo(person: Person, on: boolean): Promise<void>;
  openChat(person: Person): Promise<void>;
  expectGreeting(
    person: Person,
    greeting: string,
    ideas: string[],
  ): Promise<void>;
  pickIdea(person: Person, label: string): Promise<void>;
  expectComposerHolds(person: Person, text: string): Promise<void>;
}

export interface SessionsDriver {
  expectListed(
    person: Person,
    agentName: string,
    text: string,
    listed: boolean,
  ): Promise<void>;
  remove(person: Person, agentName: string, text: string): Promise<void>;
  expectStillOpen(
    person: Person,
    agentName: string,
    text: string,
  ): Promise<void>;
}

export interface LiveDriver {
  watchAgents(person: Person): Promise<void>;
  expectAgentChanged(
    person: Person,
    agentName: string,
    listed: boolean,
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
 * UNIT_BOUNDARY_DESCRIPTION: what a person does and observes in the When and Then steps of examples and journeys, by capability (session, agents, chat, sessions, live views, environment, egress, assistant, artifacts, connections), independent of the surface they use. Each surface implements every capability its tagged scenarios reach, and the same feature file runs through each surface as its own Playwright project.
 */
export interface Driver {
  readonly surface: Surface;
  readonly session: SessionDriver;
  readonly agents: AgentsDriver;
  readonly chat: ChatDriver;
  readonly artifacts: ArtifactsDriver;
  readonly connections: ConnectionsDriver;
  readonly sessions: SessionsDriver;
  readonly environment: EnvironmentDriver;
  readonly egress: EgressDriver;
  readonly assistant: AssistantDriver;
  readonly live: LiveDriver;
}
