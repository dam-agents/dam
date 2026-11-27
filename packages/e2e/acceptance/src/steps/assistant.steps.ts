import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

import { mockTemplateId } from "../config.js";
import { test } from "../fixtures.js";
import type { Person, Persona } from "../people.js";
import type { World } from "../world.js";

const { Given, When, Then } = createBdd(test);

const assistant = "the assistant";

/** UNIT_BOUNDARY_DESCRIPTION: waits until the person's assistant exists and records it, then puts the person back as the example found them when it ends: the switch off and the assistant deleted. */
async function awaitAssistant(world: World, person: Person): Promise<string> {
  let agentId = "";
  await expect
    .poll(
      async () => {
        const state = await person.api.assistants.state.query();
        const listed = (await person.api.agents.list.query()).some(
          (a) => a.id === state?.agentId,
        );
        agentId = state?.ready && listed ? state.agentId : "";
        return agentId;
      },
      { timeout: 120_000, message: `${person.persona} got no assistant` },
    )
    .not.toBe("");
  const { name } = await person.api.agents.get.query({ id: agentId });
  world.agents.set(assistant, { owner: person.persona, name, id: agentId });
  world.made.push({ kind: "agent", owner: person.persona, id: agentId });
  return agentId;
}

function putBack(world: World, person: Person): void {
  world.undo.push(() =>
    person.api.features.setFlag.mutate({
      feature: "dambledore",
      enabled: false,
    }),
  );
}

Given(
  "{word} has an assistant",
  async ({ person, world }, persona: Persona) => {
    const someone = await person(persona);
    putBack(world, someone);
    await someone.api.features.setFlag.mutate({
      feature: "dambledore",
      enabled: true,
    });
    await awaitAssistant(world, someone);
  },
);

Given(
  "{word} has an agent called exactly {string}",
  async ({ person, world }, persona: Persona, name: string) => {
    const owner = await person(persona);
    const made = await owner.api.agents.create.mutate({
      name,
      templateId: mockTemplateId,
    });
    world.agents.set(name, { owner: persona, name, id: made.id });
    world.made.push({ kind: "agent", owner: persona, id: made.id });
  },
);

When(
  "{word} switches the assistant {word}",
  async ({ driver, person, world }, persona: Persona, onOff: string) => {
    const someone = await person(persona);
    if (onOff === "on") putBack(world, someone);
    await driver.assistant.switchTo(someone, onOff === "on");
  },
);

Given(
  "{word} has opened the chat of the assistant",
  async ({ driver, person }, persona: Persona) =>
    driver.assistant.openChat(await person(persona)),
);

When(
  "{word} opens the chat of the assistant",
  async ({ driver, person }, persona: Persona) =>
    driver.assistant.openChat(await person(persona)),
);

When(
  "{word} picks the idea {string}",
  async ({ driver, person }, persona: Persona, label: string) =>
    driver.assistant.pickIdea(await person(persona), label),
);

Then(
  "{word} has an assistant called {string}",
  async ({ person, world }, persona: Persona, name: string) => {
    await awaitAssistant(world, await person(persona));
    expect(world.agent(assistant).name).toBe(name);
  },
);

Then(
  "{word} gets no assistant, and the {string} {word} made stays {word}'s own",
  async (
    { person, world },
    persona: Persona,
    name: string,
    _maker: Persona,
    _holder: Persona,
  ) => {
    const owner = await person(persona);
    const own = world.agent(name).id;
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    const named = (await owner.api.agents.list.query()).filter(
      (a) => a.name === name,
    );
    expect(named.map((a) => a.id)).toEqual([own]);
    const state = await owner.api.assistants.state.query();
    expect(state?.ready && state.agentId === own).toBeFalsy();
  },
);

Then(
  "{word} still has the assistant among the agents",
  async ({ person, world }, persona: Persona) => {
    const owner = await person(persona);
    const { id } = world.agent(assistant);
    expect((await owner.api.agents.list.query()).some((a) => a.id === id)).toBe(
      true,
    );
  },
);

Then(
  "{word} is greeted with {string} and offered the ideas {string}",
  async (
    { driver, person },
    persona: Persona,
    greeting: string,
    ideas: string,
  ) =>
    driver.assistant.expectGreeting(
      await person(persona),
      greeting,
      ideas.split(/,\s*/),
    ),
);

Then(
  "the message of {word} holds {string}, not yet sent",
  async ({ driver, person }, persona: Persona, text: string) =>
    driver.assistant.expectComposerHolds(await person(persona), text),
);
