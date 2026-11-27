import { expect } from "@playwright/test";

import type { Person } from "../../people.js";
import { customHeader, type World } from "../../world.js";
import type { ConnectionsDriver } from "../driver.js";

async function grantsOf(person: Person, agentId: string): Promise<string[]> {
  return (
    await person.api.connections.getAgentConnections.query({ agentId })
  ).connections.map((c) => c.connectionId);
}

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
      const names =
        listings.get(person.persona) ??
        (await person.api.connections.list.query()).map((c) => c.name);
      const shown = world.connections.get(name)?.name ?? name;
      expect(names.includes(shown)).toBe(listed);
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
    async make(person, name, host, forAgent) {
      const made = await person.api.connections.create.mutate(
        customHeader(world, name, host),
      );
      world.connections.set(name, {
        owner: person.persona,
        name: world.unique(name),
        id: made.id,
      });
      world.made.push({
        kind: "connection",
        owner: person.persona,
        id: made.id,
      });
      if (forAgent !== undefined)
        await person.api.connections.updateAgentConnections.mutate({
          agentId: world.agent(forAgent).id,
          grant: [made.id],
          revoke: [],
        });
      world.note({ step: "connection made", name, id: made.id, forAgent });
    },
    async remove(person, name) {
      await person.api.connections.delete.mutate({
        id: world.connection(name).id,
      });
      world.note({ step: "connection removed", name });
    },
    async replaceSecret(person, name) {
      await person.api.connections.update.mutate({
        id: world.connection(name).id,
        value: world.unique("acceptance-replaced-secret"),
      });
      world.note({ step: "secret replaced", name });
    },
    async expectHeld(person, connectionName, agentName, held) {
      const agentId = world.agent(agentName).id;
      const connectionId = world.connection(connectionName).id;
      await expect
        .poll(
          async () => (await grantsOf(person, agentId)).includes(connectionId),
          {
            timeout: 30_000,
            message: `${agentName} ${held ? "does not hold" : "still holds"} ${connectionName}`,
          },
        )
        .toBe(held);
    },
  };
}
