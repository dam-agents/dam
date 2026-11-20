import { createBdd } from "playwright-bdd";

import { test } from "../fixtures.js";
import type { Persona } from "../people.js";

const { Given, When, Then } = createBdd(test);

Given(
  "{word} has a running agent called {string}",
  async ({ setup }, persona: Persona, name: string) =>
    setup.runningAgent(persona, name),
);

Given(
  "{word} has a running agent called {string} that answers {string}",
  async ({ setup }, persona: Persona, name: string, answer: string) =>
    setup.runningAgent(persona, name, { answer }),
);

Given(
  "{word} has an agent called {string}",
  async ({ setup }, persona: Persona, name: string) =>
    setup.agent(persona, name),
);

Given("{string} has gone to sleep", async ({ setup }, name: string) =>
  setup.sleep(name),
);

Given(
  "{word} has an answer from {string} in the chat",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.chat.send(await person(persona), name, "hello"),
);

When(
  "{word} opens the settings of {string} from its answer",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.agents.openSettingsFromAnswer(await person(persona), name),
);

When(
  "{word} opens the old address of the {word} of {string}",
  async ({ driver, person }, persona: Persona, section: string, name: string) =>
    driver.agents.openOldAddress(await person(persona), name, section),
);

When(
  "{word} looks at the agents",
  async ({ driver, person }, persona: Persona) =>
    driver.agents.lookAt(await person(persona)),
);

When(
  "{word} makes an agent from the Generalist starter kit, known here as {string}",
  async ({ driver, person }, persona: Persona, alias: string) =>
    driver.agents.makeFromGeneralist(await person(persona), alias),
);

When(
  "{word} makes an agent called {string}",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.agents.make(await person(persona), name),
);

When(
  "{word} deletes {string}",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.agents.remove(await person(persona), name),
);

Then(
  "{word} sees an agent called {string}",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.agents.expectListed(await person(persona), name, true),
);

Then(
  "{word} does not see an agent called {string}",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.agents.expectListed(await person(persona), name, false),
);

Then(
  "{string} holds {word}'s OpenAI provider",
  async ({ driver, person }, agent: string, persona: Persona) =>
    driver.agents.expectProvider(await person(persona), agent, "openai"),
);

Then(
  "{word} sees {string} idle",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.agents.expectIdle(await person(persona), name),
);

Then(
  "{word} sees the settings of {string} over its chat",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.agents.expectSettingsOverChat(await person(persona), name),
);

Then(
  "{word} sees the settings of {string} over its chat, at its {word}",
  async ({ driver, person }, persona: Persona, name: string, section: string) =>
    driver.agents.expectSettingsOverChat(await person(persona), name, section),
);
