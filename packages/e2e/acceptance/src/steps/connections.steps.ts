import { createBdd } from "playwright-bdd";

import { test } from "../fixtures.js";
import type { Persona } from "../people.js";

const { Given, When, Then } = createBdd(test);

Given(
  "{word} has a connection called {string} to {string}",
  async ({ setup }, persona: Persona, name: string, host: string) =>
    setup.connection(persona, name, { host }),
);

Given(
  "{word} has a second OpenAI connection called {string}",
  async ({ setup }, persona: Persona, name: string) =>
    setup.connection(persona, name, { provider: "openai" }),
);

When(
  "{word} looks at the connections",
  async ({ driver, person }, persona: Persona) =>
    driver.connections.lookAt(await person(persona)),
);

When(
  "{word} grants {string} to {string}",
  async (
    { driver, person },
    persona: Persona,
    connection: string,
    agent: string,
  ) => driver.connections.grant(await person(persona), connection, agent),
);

Then(
  "{word} sees a connection called {string}",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.connections.expectListed(await person(persona), name, true),
);

Then(
  "{word} does not see a connection called {string}",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.connections.expectListed(await person(persona), name, false),
);

Then(
  "{word} is told the agent already has an OpenAI provider",
  async ({ driver, person }, persona: Persona) =>
    driver.connections.expectGrantRefused(
      await person(persona),
      /provider|alias|openai/i,
    ),
);
