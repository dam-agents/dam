import { expect, test } from "@playwright/test";

import { mockTemplateId } from "../../config.js";
import type { Person } from "../../people.js";
import type { World } from "../../world.js";
import type { AgentsDriver } from "../driver.js";

export function apiAgents(world: World): AgentsDriver {
  const listings = new Map<string, string[]>();
  return {
    async lookAt(person) {
      const names = (await person.api.agents.list.query()).map((a) => a.name);
      world.note({ step: "agents listed", persona: person.persona, names });
      listings.set(person.persona, names);
    },
    async expectListed(person, name, listed) {
      const names = listings.get(person.persona);
      expect(names, `${person.persona} looked at no agents`).toBeDefined();
      expect(names!.includes(world.nameOf(name))).toBe(listed);
    },
    async makeFromGeneralist() {
      test.skip(true, "the Generalist starter kit is a card of the web UI");
    },
    async make(person, name) {
      const made = await person.api.agents.create.mutate({
        name: world.unique(name),
        templateId: mockTemplateId,
      });
      world.agents.set(name, {
        owner: person.persona,
        name: made.name,
        id: made.id,
      });
      world.made.push({ kind: "agent", owner: person.persona, id: made.id });
      world.note({ step: "agent made", name: made.name, id: made.id });
    },
    async expectProvider(person, agentName, templateId) {
      const { connections } =
        await person.api.connections.getAgentConnections.query({
          agentId: world.agent(agentName).id,
        });
      const owned = new Map(
        (await person.api.connections.list.query()).map((c) => [
          c.id,
          c.templateId,
        ]),
      );
      const granted = connections.map((c) => owned.get(c.connectionId));
      world.note({ step: "agent's grants", agentName, granted });
      expect(granted).toContain(templateId);
    },
    async remove(person: Person, name: string) {
      const agent = world.agent(name);
      await person.api.agents.delete.mutate({ id: agent.id });
      await expect
        .poll(
          async () =>
            (await person.api.agents.list.query()).some(
              (a) => a.id === agent.id,
            ),
          { timeout: 120_000, intervals: [2_000] },
        )
        .toBe(false);
      listings.delete(person.persona);
    },
  };
}
