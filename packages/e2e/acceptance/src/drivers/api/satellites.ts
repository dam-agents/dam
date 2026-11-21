import { expect } from "@playwright/test";

import { attempt } from "../../keys.js";
import type { World } from "../../world.js";
import type { SatellitesDriver } from "../driver.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: an owner's satellites over the public API: the listing, and a grant to an agent or its revoke; a refused grant is kept as the example's outcome.
 */
export function apiSatellites(world: World): SatellitesDriver {
  const listed = async (person: Parameters<SatellitesDriver["lookAt"]>[0]) =>
    person.api.satellites.list.query();
  return {
    async lookAt(person) {
      world.note({
        step: "satellites listed",
        satellites: await listed(person),
      });
    },
    async expectListed(person, name, view) {
      const found = (await listed(person)).find(
        (s) => s.name === world.unique(name),
      );
      if (view === undefined) {
        expect(found, `${person.persona} sees ${name}`).toBeUndefined();
        return;
      }
      expect(found, `${person.persona} does not see ${name}`).toBeDefined();
      expect(found!.host).toBe(view.host);
      expect(found!.tools.map((t) => t.name)).toEqual(view.tools);
      expect(found!.online).toBe(true);
      expect(found!.draining).toBe(view.state === "shutting down");
    },
    async expectNone(person) {
      expect(await listed(person)).toEqual([]);
    },
    async grant(person, satellite, agentName) {
      world.outcome = await attempt(() =>
        person.api.satellites.grant.mutate({
          satellite: world.unique(satellite),
          agentId: world.agent(agentName).id,
        }),
      );
    },
    async revoke(person, satellite, agentName) {
      await person.api.satellites.revoke.mutate({
        satellite: world.unique(satellite),
        agentId: world.agent(agentName).id,
      });
    },
    async expectHeld(person, satellite, agentName, held) {
      const found = (await listed(person)).find(
        (s) => s.name === world.unique(satellite),
      );
      expect(
        found?.grantedAgentIds.includes(world.agent(agentName).id) ?? false,
      ).toBe(held);
    },
    async remove(person, satellite) {
      await person.api.satellites.remove.mutate(world.unique(satellite));
    },
  };
}
