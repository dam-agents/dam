import { expect } from "@playwright/test";

import type { Person } from "../../people.js";
import type { World } from "../../world.js";
import type { ArtifactsDriver } from "../driver.js";

export function apiArtifacts(world: World): ArtifactsDriver {
  const library = async (person: Person) => {
    const items = (await person.api.artifactLibrary.list.query()).map((a) => ({
      title: a.title,
      agentId: a.agentId,
    }));
    world.note({ step: "library listed", persona: person.persona, items });
    return items;
  };
  return {
    async expectInLibrary(person, title) {
      expect((await library(person)).map((a) => a.title)).toContain(title);
    },
    async expectPublishedBy(person, title, agentName) {
      const item = (await library(person)).find((a) => a.title === title);
      expect(item, `no artifact "${title}" in the library`).toBeDefined();
      expect(item!.agentId).toBe(world.agent(agentName).id);
    },
  };
}
