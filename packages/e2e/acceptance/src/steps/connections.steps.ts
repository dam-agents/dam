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
  "{word} has a connection called {string} to {string} that sets no variable",
  async ({ setup }, persona: Persona, name: string, host: string) =>
    setup.connection(persona, name, { host, variable: false }),
);

Given(
  "{word} has granted {string} to {string}",
  async ({ setup }, persona: Persona, connection: string, agent: string) =>
    setup.grant(persona, connection, agent),
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

When(
  "{word} makes a connection called {string} to {string}",
  async ({ driver, person }, persona: Persona, name: string, host: string) =>
    driver.connections.make(await person(persona), name, host),
);

When(
  "{word} makes a connection called {string} to {string} for {string}",
  async (
    { driver, person },
    persona: Persona,
    name: string,
    host: string,
    agent: string,
  ) => driver.connections.make(await person(persona), name, host, agent),
);

When(
  "{word} removes the connection {string}",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.connections.remove(await person(persona), name),
);

When(
  "{word} replaces the secret of {string}",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.connections.replaceSecret(await person(persona), name),
);

Then(
  "{string} holds the connection {string}",
  async ({ driver, person, world }, agent: string, connection: string) =>
    driver.connections.expectHeld(
      await person(world.agent(agent).owner),
      connection,
      agent,
      true,
    ),
);

Then(
  "{string} does not hold the connection {string}",
  async ({ driver, person, world }, agent: string, connection: string) =>
    driver.connections.expectHeld(
      await person(world.agent(agent).owner),
      connection,
      agent,
      false,
    ),
);

Then(
  "{word} is told {string} can use only one of them",
  async ({ driver, person }, persona: Persona, _agent: string) =>
    driver.connections.expectGrantRefused(
      await person(persona),
      /can use only one of/,
    ),
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
