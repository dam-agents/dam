import { expect } from "@playwright/test";

import type { World } from "../../world.js";
import type { ConnectionsDriver } from "../driver.js";

export function apiConnections(world: World): ConnectionsDriver {
  const listings = new Map<string, string[]>();
  let refusal: string | undefined;
  return {
    async lookAt(person) {
      const names = (await person.api.connections.list.query()).map(
        (c) => c.name,
      );
      world.note({
        step: "connections listed",
        persona: person.persona,
        names,
      });
      listings.set(person.persona, names);
    },
    async expectListed(person, name, listed) {
      const names = listings.get(person.persona);
      expect(names, `${person.persona} looked at no connections`).toBeDefined();
      const shown = world.connections.get(name)?.name ?? name;
      expect(names!.includes(shown)).toBe(listed);
    },
    async grant(person, connectionName, agentName) {
      refusal = undefined;
      try {
        await person.api.connections.updateAgentConnections.mutate({
          agentId: world.agent(agentName).id,
          grant: [world.connection(connectionName).id],
          revoke: [],
        });
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
      }
      world.note({ step: "grant", connectionName, agentName, refusal });
    },
    async expectGrantRefused(_person, reason) {
      expect(refusal, "the grant was accepted").toBeDefined();
      expect(refusal!).toMatch(reason);
    },
  };
}
