import { expect } from "@playwright/test";

import type { Person } from "../../people.js";
import type { World } from "../../world.js";
import type { EnvironmentDriver } from "../driver.js";

async function envOf(person: Person, id: string) {
  return (await person.api.agents.get.query({ id })).env ?? [];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an agent's environment over the public API: the owner's own variables are one list, read and written whole, so a change keeps every other variable, the warm agent's scripting included. A variable an example sets is taken off the agent when it ends.
 */
export function apiEnvironment(world: World): EnvironmentDriver {
  return {
    async set(person, agentName, name, value) {
      const { id } = world.agent(agentName);
      const env = await envOf(person, id);
      await person.api.agents.setEnv.mutate({
        id,
        env: [
          ...env.filter((v) => v.name !== name),
          { name, value: world.unique(value) },
        ],
      });
      world.undo.push(async () =>
        person.api.agents.setEnv.mutate({
          id,
          env: (await envOf(person, id)).filter((v) => v.name !== name),
        }),
      );
      world.note({ step: "variable set", agentName, name });
    },
    async remove(person, agentName, name) {
      const { id } = world.agent(agentName);
      await person.api.agents.setEnv.mutate({
        id,
        env: (await envOf(person, id)).filter((v) => v.name !== name),
      });
      world.note({ step: "variable removed", agentName, name });
    },
    async expectShown(person, agentName, name, value) {
      const env = await envOf(person, world.agent(agentName).id);
      expect(env).toContainEqual(
        expect.objectContaining({ name, value: world.unique(value) }),
      );
    },
  };
}
