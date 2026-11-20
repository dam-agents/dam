import type { Person } from "../people.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a person does and observes in the examples' When and Then steps, independent of the surface they use. Each implementation drives one public surface of the install, the API or the web UI, and the same feature file runs through each of them as its own Playwright project.
 */
export interface Driver {
  readonly surface: "api" | "ui";
  sendMessage(person: Person, agentName: string, text: string): Promise<void>;
  expectAnswer(person: Person, agentName: string, text: string): Promise<void>;
  lookAtAgents(person: Person): Promise<void>;
  expectAgentListed(
    person: Person,
    agentName: string,
    listed: boolean,
  ): Promise<void>;
}
