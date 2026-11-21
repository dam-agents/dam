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
  "{string} has since changed {string} to {string}",
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

Given("{string} is asleep", async ({ setup }, kb: string) => setup.sleep(kb));

Given(
  "{word} holds {word}'s share string for {string}",
  async ({ person, world }, holder: Persona, owner: Persona, kb: string) => {
    holdings(world).set(
      `${holder}/${kb}`,
      await currentShareString(await person(owner), world, kb),
    );
  },
);

for (const [given, when] of [
  [
    "{word} has rotated the share string of {string}",
    "{word} rotates the share string of {string}",
  ],
  ["{word} has unshared {string}", "{word} unshares {string}"],
] as const) {
  const act = async (owner: Person, world: World, kb: string) => {
    const agentId = world.agent(kb).id;
    if (given.includes("rotated"))
      await owner.api.kbShares.rotate.mutate({ agentId });
    else await owner.api.kbShares.revoke.mutate({ agentId });
  };
  Given(given, async ({ person, world }, persona: Persona, kb: string) =>
    act(await person(persona), world, kb),
  );
  When(when, async ({ person, world }, persona: Persona, kb: string) =>
    act(await person(persona), world, kb),
  );
}

When(
  "{word} refreshes the share of {string}",
  async ({ person, world }, persona: Persona, kb: string) =>
    (await person(persona)).api.kbShares.refresh.mutate({
      agentId: world.agent(kb).id,
    }),
);

When(
  "{word} reads {string} of {string} with {word}'s share string",
  async (
    { person, world },
    _reader: Persona,
    path: string,
    kb: string,
    owner: Persona,
  ) => {
    const shareString = await currentShareString(
      await person(owner),
      world,
      kb,
    );
    world.outcome = await attempt(() =>
      callShareTool(shareString, "read_document", { path }),
    );
  },
);

When(
  "{word} searches {string} for {string} with {word}'s share string",
  async (
    { person, world },
    _reader: Persona,
    kb: string,
    words: string,
    owner: Persona,
  ) => {
    const shareString = await currentShareString(
      await person(owner),
      world,
      kb,
    );
    world.outcome = await attempt(() =>
      callShareTool(shareString, "search_knowledge", {
        query: world.unique(words),
      }),
    );
  },
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

When(
  "{word} connects the share string {word} holds for {string}",
  async ({ person, world }, persona: Persona, _holder: Persona, kb: string) => {
    const someone = await person(persona);
    const shareString = holdings(world).get(`${persona}/${kb}`);
    expect(
      shareString,
      `${persona} holds no share string for ${kb}`,
    ).toBeDefined();
    world.outcome = await attempt(async () => {
      const made = await someone.api.connections.create.mutate({
        templateId: "shared-knowledge-base",
        name: world.unique(kb),
        authKind: "header",
        value: shareString!,
      });
      world.made.push({ kind: "connection", owner: persona, id: made.id });
      return made;
    });
  },
);

When(
  "{word} asks for the share string of {string} with the key {string}",
  async ({ world }, _persona: Persona, kb: string, key: string) => {
    world.outcome = await attempt(() =>
      world.keys
        .get(key)!
        .api.kbShares.reveal.mutate({ agentId: world.agent(kb).id }),
    );
  },
);

Then(
  "{word} reads {string}",
  async ({ world }, _persona: Persona, text: string) => {
    expect(world.outcome?.refused).toBeUndefined();
    expect(String(world.outcome?.value)).toContain(world.unique(text));
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
  "{word} reads {string} in {string} of {string} with {word}'s share string within one minute",
  async (
    { person, world },
    _reader: Persona,
    text: string,
    path: string,
    kb: string,
    owner: Persona,
  ) => {
    const shareString = await currentShareString(
      await person(owner),
      world,
      kb,
    );
    await expect
      .poll(() => callShareTool(shareString, "read_document", { path }), {
        timeout: 60_000,
        intervals: [3_000],
      })
      .toContain(world.unique(text));
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

Then(
  "{word} has a connection to the knowledge base {string}",
  async ({ person, world }, persona: Persona, _kb: string) => {
    expect(
      world.outcome?.refused,
      "the connection was refused",
    ).toBeUndefined();
    const { id } = world.outcome!.value as { id: string };
    expect(
      (await (await person(persona)).api.connections.list.query()).some(
        (c) => c.id === id,
      ),
    ).toBe(true);
  },
);

Then(
  "{word} is told the share string is unknown or revoked",
  async ({ world }, _persona: Persona) => {
    expect(world.outcome?.value, "the connection was made").toBeUndefined();
    expect(world.outcome?.message).toMatch(/unknown or revoked/);
  },
);
