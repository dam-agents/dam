import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

import { test } from "../fixtures.js";
import type { Persona } from "../people.js";

const { Given, When, Then } = createBdd(test);

Given(
  "{word} has talked to {string} about {string}",
  async ({ setup }, persona: Persona, agent: string, text: string) =>
    setup.session(persona, agent, text),
);

Given(
  "{word} is looking at the agents",
  async ({ driver, person }, persona: Persona) =>
    driver.live.watchAgents(await person(persona)),
);

When(
  "{word} deletes the session {string} of {string}",
  async ({ driver, person }, persona: Persona, text: string, agent: string) =>
    driver.sessions.remove(await person(persona), agent, text),
);

When(
  "{word} makes an agent called {string} through the API",
  async ({ setup }, persona: Persona, name: string) =>
    setup.agent(persona, name),
);

When(
  "{word} deletes {string} through the API",
  async ({ person, world }, persona: Persona, name: string) => {
    const owner = await person(persona);
    const { id } = world.agent(name);
    await owner.api.agents.delete.mutate({ id });
    await expect
      .poll(
        async () =>
          (await owner.api.agents.list.query()).some((a) => a.id === id),
        { timeout: 120_000, intervals: [1_000, 2_000] },
      )
      .toBe(false);
  },
);

Then(
  "{word} sees a session of {string} called {string}",
  async ({ driver, person }, persona: Persona, agent: string, text: string) =>
    driver.sessions.expectListed(await person(persona), agent, text, true),
);

Then(
  "{word} does not see a session of {string} called {string}",
  async ({ driver, person }, persona: Persona, agent: string, text: string) =>
    driver.sessions.expectListed(await person(persona), agent, text, false),
);

Then(
  "{word} still has the session {string} of {string} open",
  async ({ driver, person }, persona: Persona, text: string, agent: string) =>
    driver.sessions.expectStillOpen(await person(persona), agent, text),
);

Then(
  "{word} sees {string} appear without a reload",
  async ({ driver, person }, persona: Persona, agent: string) =>
    driver.live.expectAgentChanged(await person(persona), agent, true),
);

Then(
  "{word} sees {string} disappear without a reload",
  async ({ driver, person }, persona: Persona, agent: string) =>
    driver.live.expectAgentChanged(await person(persona), agent, false),
);
