import { connectionEgressPlaceholder } from "api-server-api";
import { createBdd } from "playwright-bdd";

import { test } from "../fixtures.js";
import type { Persona } from "../people.js";
import { untilAgentAnswers, untilAgentHolds } from "../probe.js";

const { Given, When, Then } = createBdd(test);

const withKey = (envName: string) => `x-api-key:$${envName}`;

Given(
  "{word} has a connection called {string} to {string} with the key {string} in {word}",
  async (
    { setup },
    persona: Persona,
    name: string,
    host: string,
    key: string,
    envName: string,
  ) => setup.connection(persona, name, { host, key, envName }),
);

Given(
  "{word} has a running agent called {string} that requires naming its connections",
  async ({ setup }, persona: Persona, name: string) =>
    setup.runningAgent(persona, name, { requiresNaming: true }),
);

Given(
  "{word} has a running agent called {string} that does not require naming its connections",
  async ({ setup }, persona: Persona, name: string) =>
    setup.runningAgent(persona, name, { requiresNaming: false }),
);

Given(
  "{word} has allowed all requests to {string} for {string}",
  async ({ setup }, persona: Persona, host: string, agent: string) =>
    setup.allowAll(persona, host, agent),
);

Given(
  "{word} has set {word} to {string} for {string}",
  async (
    { driver, person, world },
    persona: Persona,
    name: string,
    value: string,
    agent: string,
  ) => {
    const owner = await person(persona);
    await driver.environment.set(owner, agent, name, value);
    await untilAgentHolds(world, owner, agent, name, world.unique(value));
  },
);

When(
  "{word} sets {word} to {string} for {string}",
  async (
    { driver, person },
    persona: Persona,
    name: string,
    value: string,
    agent: string,
  ) => driver.environment.set(await person(persona), agent, name, value),
);

When(
  "{word} removes {word} from {string}",
  async ({ driver, person }, persona: Persona, name: string, agent: string) =>
    driver.environment.remove(await person(persona), agent, name),
);

When(
  "{word} asks {string} to call {string}",
  async ({ driver, person }, persona: Persona, agent: string, url: string) =>
    driver.chat.send(await person(persona), agent, `__FETCH__ ${url}`, true),
);

When(
  "{word} asks {string} to call {string} with its {word}",
  async (
    { driver, person },
    persona: Persona,
    agent: string,
    url: string,
    envName: string,
  ) =>
    driver.chat.send(
      await person(persona),
      agent,
      `__FETCH__ ${url} ${withKey(envName)}`,
      true,
    ),
);

When(
  "{word} replaces the key of {string} with {string}",
  async ({ person, world }, persona: Persona, name: string, key: string) => {
    const owner = await person(persona);
    await owner.api.connections.update.mutate({
      id: world.connection(name).id,
      value: world.unique(key),
    });
  },
);

Then(
  "within two minutes {string} reads {word} as {string}",
  async ({ person, world }, agent: string, name: string, value: string) =>
    untilAgentHolds(
      world,
      await person(world.agent(agent).owner),
      agent,
      name,
      world.unique(value),
    ),
);

Then(
  "within two minutes {string} reads {word} as the placeholder of {string}",
  async ({ person, world }, agent: string, name: string, connection: string) =>
    untilAgentHolds(
      world,
      await person(world.agent(agent).owner),
      agent,
      name,
      connectionEgressPlaceholder(world.connection(connection).id),
    ),
);

Then(
  "within two minutes the calls of {string} to {string} with its {word} carry {string}",
  async (
    { person, world },
    agent: string,
    url: string,
    envName: string,
    key: string,
  ) =>
    untilAgentAnswers(
      world,
      await person(world.agent(agent).owner),
      agent,
      `__FETCH__ ${url} ${withKey(envName)}`,
      world.unique(key),
    ),
);

Then(
  "{word} sees {word} set to {string} in the environment of {string}",
  async (
    { driver, person },
    persona: Persona,
    name: string,
    value: string,
    agent: string,
  ) =>
    driver.environment.expectShown(await person(persona), agent, name, value),
);

Then(
  "{word} sees that {string} got status {int}",
  async ({ driver, person }, persona: Persona, agent: string, status: number) =>
    driver.chat.expectAnswer(await person(persona), agent, `[fetch ${status}]`),
);

Then(
  "{word} sees {string} answer without {string}",
  async ({ driver, person }, persona: Persona, agent: string, text: string) =>
    driver.chat.expectAnswerWithout(await person(persona), agent, text),
);

Then(
  "{word} sees {string} answer the placeholder of {string}",
  async (
    { driver, person, world },
    persona: Persona,
    agent: string,
    connection: string,
  ) =>
    driver.chat.expectAnswer(
      await person(persona),
      agent,
      connectionEgressPlaceholder(world.connection(connection).id),
    ),
);
