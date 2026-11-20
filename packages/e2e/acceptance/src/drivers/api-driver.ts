import { expect } from "@playwright/test";

import { promptOnce, type Turn } from "../acp.js";
import type { Person } from "../people.js";
import type { World } from "../world.js";
import type { Driver } from "./driver.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Driver over the install's public API: tRPC for the agents an owner lists, and the ACP relay for a chat turn, as the CLI and other clients use them.
 */
export class ApiDriver implements Driver {
  readonly surface = "api";
  private readonly turns = new Map<string, Turn>();
  private readonly listings = new Map<string, string[]>();

  constructor(private readonly world: World) {}

  async sendMessage(person: Person, agentName: string, text: string) {
    const agent = this.world.agent(agentName);
    const turn = await promptOnce(agent.id, await person.token(), text);
    this.world.note({ step: "acp turn", agent: agent.name, turn });
    this.turns.set(`${person.persona}/${agentName}`, turn);
  }

  async expectAnswer(person: Person, agentName: string, text: string) {
    const turn = this.turns.get(`${person.persona}/${agentName}`);
    expect(
      turn,
      `${person.persona} sent nothing to ${agentName}`,
    ).toBeDefined();
    expect(turn!.reply).toContain(text);
    expect(turn!.stopReason).toBe("end_turn");
  }

  async lookAtAgents(person: Person) {
    const names = (await person.api.agents.list.query()).map((a) => a.name);
    this.world.note({ step: "agents listed", persona: person.persona, names });
    this.listings.set(person.persona, names);
  }

  async expectAgentListed(person: Person, agentName: string, listed: boolean) {
    const names = this.listings.get(person.persona);
    expect(names, `${person.persona} looked at no agents`).toBeDefined();
    const name = this.world.agents.get(agentName)?.name ?? agentName;
    expect(names!.includes(name)).toBe(listed);
  }
}
