import { createBdd } from "playwright-bdd";

import { test } from "../fixtures.js";
import type { Persona } from "../people.js";

const { Given, Then } = createBdd(test);

Given(
  "{word} has a running agent called {string} that publishes an artifact {string}",
  async ({ setup }, persona: Persona, name: string, title: string) =>
    setup.runningAgent(persona, name, { publishes: title }),
);

Then(
  "{word} sees the artifact {string} in the library",
  async ({ driver, person, world }, persona: Persona, title: string) =>
    driver.artifacts.expectInLibrary(
      await person(persona),
      world.unique(title),
    ),
);

Then(
  "{word} sees that {string} published the artifact {string}",
  async (
    { driver, person, world },
    persona: Persona,
    agent: string,
    title: string,
  ) =>
    driver.artifacts.expectPublishedBy(
      await person(persona),
      world.unique(title),
      agent,
    ),
);
