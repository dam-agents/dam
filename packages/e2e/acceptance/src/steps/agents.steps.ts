import { createBdd } from "playwright-bdd";

import { test } from "../fixtures.js";
import type { Persona } from "../people.js";

const { Given, When, Then } = createBdd(test);

Given(
  "{word} has a running agent called {string}",
  async ({ setup }, persona: Persona, name: string) =>
    setup.runningAgent(persona, name, undefined),
);

Given(
  "{word} has a running agent called {string} that answers {string}",
  async ({ setup }, persona: Persona, name: string, answer: string) =>
    setup.runningAgent(persona, name, answer),
);

When(
  "{word} sends {string} to {string}",
  async ({ driver, person }, persona: Persona, text: string, name: string) =>
    driver.sendMessage(await person(persona), name, text),
);

When(
  "{word} looks at the agents",
  async ({ driver, person }, persona: Persona) =>
    driver.lookAtAgents(await person(persona)),
);

Then(
  "{word} sees {string} answer {string}",
  async (
    { driver, person, world },
    persona: Persona,
    name: string,
    answer: string,
  ) => driver.expectAnswer(await person(persona), name, world.unique(answer)),
);

Then(
  "{word} sees an agent called {string}",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.expectAgentListed(await person(persona), name, true),
);

Then(
  "{word} does not see an agent called {string}",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.expectAgentListed(await person(persona), name, false),
);
