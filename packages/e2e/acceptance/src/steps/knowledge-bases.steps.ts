import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

import { test } from "../fixtures.js";
import { callShareTool, opens, untilPublished, writePage } from "../kb.js";
import { attempt } from "../keys.js";
import type { Person, Persona } from "../people.js";
import type { World } from "../world.js";

const { Given, When, Then } = createBdd(test);

/** UNIT_BOUNDARY_DESCRIPTION: the share strings people of an example hold, by holder and knowledge base. */
const held = new WeakMap<World, Map<string, string>>();

function holdings(world: World): Map<string, string> {
  if (!held.has(world)) held.set(world, new Map());
  return held.get(world)!;
}

async function currentShareString(owner: Person, world: World, kb: string) {
  return (
    await owner.api.kbShares.reveal.mutate({ agentId: world.agent(kb).id })
  ).shareString;
}

async function share(owner: Person, world: World, kb: string) {
  const agentId = world.agent(kb).id;
  await owner.api.kbShares.create.mutate({ agentId, roots: ["wiki"] });
  await untilPublished(owner, agentId);
}

Given(
  "{word} has a knowledge base called {string} that shares its folder {string}",
  async ({ setup }, persona: Persona, name: string, folder: string) =>
    setup.knowledgeBase(persona, name, folder),
);

Given(
  "{string} holds {string} saying {string}",
  async ({ person, world }, kb: string, path: string, text: string) => {
    const record = world.agent(kb);
    await writePage(
      await person(record.owner),
      record.id,
      path,
      world.unique(text),
    );
  },
);

Given(
  "{word} has shared {string}",
  async ({ person, world }, persona: Persona, kb: string) =>
    share(await person(persona), world, kb),
);

When(
  "{word} shares {string}",
  async ({ person, world }, persona: Persona, kb: string) =>
    share(await person(persona), world, kb),
);

Given(
  "{word} holds {word}'s share string for {string}",
  async ({ person, world }, holder: Persona, owner: Persona, kb: string) => {
    holdings(world).set(
      `${holder}/${kb}`,
      await currentShareString(await person(owner), world, kb),
    );
  },
);

When(
  "{word} rotates the share string of {string}",
  async ({ person, world }, persona: Persona, kb: string) =>
    (await person(persona)).api.kbShares.rotate.mutate({
      agentId: world.agent(kb).id,
    }),
);

Given(
  "{word} has unshared {string}",
  async ({ person, world }, persona: Persona, kb: string) =>
    (await person(persona)).api.kbShares.revoke.mutate({
      agentId: world.agent(kb).id,
    }),
);

When(
  "{word} lists the pages of {string} with {word}'s share string",
  async ({ person, world }, _reader: Persona, kb: string, owner: Persona) => {
    const shareString = await currentShareString(
      await person(owner),
      world,
      kb,
    );
    world.outcome = await attempt(() =>
      callShareTool(shareString, "list_documents", {}),
    );
  },
);

Then(
  "{word} finds the page {string}",
  async ({ world }, _persona: Persona, path: string) => {
    expect(world.outcome?.refused).toBeUndefined();
    expect(String(world.outcome?.value)).toContain(path);
  },
);

Then(
  "{word} does not find the page {string}",
  async ({ world }, _persona: Persona, path: string) => {
    expect(world.outcome?.refused).toBeUndefined();
    expect(String(world.outcome?.value)).not.toContain(path);
  },
);

Then(
  "the share string {word} holds for {string} no longer opens it",
  async ({ world }, holder: Persona, kb: string) => {
    const shareString = holdings(world).get(`${holder}/${kb}`);
    expect(
      shareString,
      `${holder} holds no share string for ${kb}`,
    ).toBeDefined();
    expect(await opens(shareString!)).toBe(false);
  },
);

Then(
  "{word}'s current share string for {string} opens it",
  async ({ person, world }, owner: Persona, kb: string) => {
    const someone = await person(owner);
    await untilPublished(someone, world.agent(kb).id);
    expect(await opens(await currentShareString(someone, world, kb))).toBe(
      true,
    );
  },
);
