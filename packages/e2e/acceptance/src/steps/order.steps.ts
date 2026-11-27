import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

import { test } from "../fixtures.js";
import type { Persona } from "../people.js";

const { Given, When, Then } = createBdd(test);

const listOf = (names: string) => names.split(/,\s*/);

Given(
  "{word} made the agents {string}, in that order",
  async ({ setup }, persona: Persona, names: string) => {
    for (const name of listOf(names)) await setup.runningAgent(persona, name);
  },
);

Given(
  "{word} has since made an agent called {string}",
  async ({ setup }, persona: Persona, name: string) =>
    setup.agent(persona, name),
);

Given(
  "{word} has not arranged any agents",
  async ({ person }, persona: Persona) => {
    await (
      await person(persona)
    ).api.sidebarOrder.setAgents.mutate({ agentIds: [] });
  },
);

Given(
  "{word} has arranged the agents as {string}",
  async ({ person, world }, persona: Persona, names: string) => {
    const owner = await person(persona);
    await owner.api.sidebarOrder.setAgents.mutate({
      agentIds: listOf(names).map((n) => world.agent(n).id),
    });
    world.undo.push(() =>
      owner.api.sidebarOrder.setAgents.mutate({ agentIds: [] }),
    );
  },
);

Given(
  "{word} has talked to {string} in sessions opened with {string}, in that order",
  async ({ setup }, persona: Persona, agent: string, texts: string) => {
    for (const text of listOf(texts)) await setup.session(persona, agent, text);
  },
);

When(
  "{word} moves {string} {word} {string}",
  async (
    { driver, person },
    persona: Persona,
    name: string,
    where: string,
    target: string,
  ) => {
    if (where !== "before" && where !== "after")
      throw new Error(`"${where}" is no place: before or after`);
    await driver.order.move(await person(persona), name, where, target);
  },
);

When(
  "{word} opens the sessions of {string}",
  async ({ driver, person }, persona: Persona, agent: string) =>
    driver.order.openSessions(await person(persona), agent),
);

When(
  "{word} sends {string} in the session {string} of {string}",
  async (
    { driver, person },
    persona: Persona,
    text: string,
    session: string,
    agent: string,
  ) => driver.order.sendIn(await person(persona), agent, session, text),
);

Then(
  "{word}'s agents are listed as {string}",
  async ({ driver, person }, persona: Persona, names: string) =>
    driver.order.expectAgents(await person(persona), listOf(names)),
);

Then(
  "{word}'s order of agents no longer names {string}",
  async ({ person, world }, persona: Persona, agent: string) => {
    const owner = await person(persona);
    await expect
      .poll(async () => (await owner.api.sidebarOrder.get.query()).agents)
      .not.toContain(world.agent(agent).id);
  },
);

Then(
  "{word} sees the sessions of {string} listed as {string}",
  async ({ driver, person }, persona: Persona, agent: string, texts: string) =>
    driver.order.expectSessions(await person(persona), agent, listOf(texts)),
);
