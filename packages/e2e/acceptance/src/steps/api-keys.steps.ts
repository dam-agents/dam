import { expect } from "@playwright/test";
import type { Scope } from "api-server-api";
import { createBdd } from "playwright-bdd";

import { mockTemplateId } from "../config.js";
import { test } from "../fixtures.js";
import { attempt, makeKey } from "../keys.js";
import type { Persona } from "../people.js";
import type { World } from "../world.js";

const { Given, When, Then } = createBdd(test);

function key(world: World, name: string) {
  const held = world.keys.get(name);
  if (held === undefined)
    throw new Error(`no Given step made a key called "${name}"`);
  return held.api;
}

const agentScope = (verb: string): Scope => {
  if (verb !== "read" && verb !== "operate" && verb !== "manage")
    throw new Error(`"${verb}" is no agent scope: read, operate or manage`);
  return `agents:${verb}`;
};

Given(
  "{word} has an API key called {string} that may {word} agents",
  async ({ person, world }, persona: Persona, name: string, verb: string) =>
    makeKey(
      world,
      world.keys,
      await person(persona),
      name,
      [agentScope(verb)],
      "*",
    ),
);

Given(
  "{word} has an API key called {string} that may {word} agents, bound to {string}",
  async (
    { person, world },
    persona: Persona,
    name: string,
    verb: string,
    agent: string,
  ) =>
    makeKey(
      world,
      world.keys,
      await person(persona),
      name,
      [agentScope(verb)],
      [world.agent(agent).id],
    ),
);

Given(
  "{word} has an API key called {string} that may read connections",
  async ({ person, world }, persona: Persona, name: string) =>
    makeKey(
      world,
      world.keys,
      await person(persona),
      name,
      ["credentials:read"],
      "*",
    ),
);

Given(
  "{word} has revoked the API key {string}",
  async ({ person, world }, persona: Persona, name: string) =>
    (await person(persona)).api.apiKeys.revoke.mutate({
      id: world.keys.get(name)!.id,
    }),
);

When(
  "{word} looks at the agents with the key {string}",
  async ({ world }, _persona: Persona, name: string) => {
    world.outcome = await attempt(async () =>
      (await key(world, name).agents.list.query()).map((a) => a.name),
    );
  },
);

When(
  "{word} reads {string} with the key {string}",
  async ({ world }, _persona: Persona, agent: string, name: string) => {
    world.outcome = await attempt(() =>
      key(world, name).agents.get.query({ id: world.agent(agent).id }),
    );
  },
);

When(
  "{word} makes an agent called {string} with the key {string}",
  async ({ world }, persona: Persona, agent: string, name: string) => {
    world.outcome = await attempt(async () => {
      const made = await key(world, name).agents.create.mutate({
        name: world.unique(agent),
        templateId: mockTemplateId,
      });
      world.agents.set(agent, { owner: persona, name: made.name, id: made.id });
      world.made.push({ kind: "agent", owner: persona, id: made.id });
      return made;
    });
  },
);

When(
  "{word} describes {string} as {string} with the key {string}",
  async (
    { world },
    _persona: Persona,
    agent: string,
    description: string,
    name: string,
  ) => {
    world.outcome = await attempt(() =>
      key(world, name).agents.update.mutate({
        id: world.agent(agent).id,
        description: world.unique(description),
      }),
    );
  },
);

When(
  "{word} puts a file in {string} with the key {string}",
  async ({ world }, _persona: Persona, agent: string, name: string) => {
    world.outcome = await attempt(() =>
      key(world, name).files.upload.mutate({
        agentId: world.agent(agent).id,
        path: `${world.unique("notes")}.txt`,
        contentBase64: Buffer.from(world.unique("a note")).toString("base64"),
      }),
    );
  },
);

When(
  "{word} looks at the connections with the key {string}",
  async ({ world }, _persona: Persona, name: string) => {
    world.outcome = await attempt(async () =>
      (await key(world, name).connections.list.query()).map((c) => c.name),
    );
  },
);

When(
  "{word} makes an API key with the key {string}",
  async ({ world }, _persona: Persona, name: string) => {
    world.outcome = await attempt(() =>
      key(world, name).apiKeys.create.mutate({
        name: world.unique("another"),
        scopes: ["agents:read"],
        agentIds: "*",
      }),
    );
  },
);

When(
  "{word} makes an API key that may manage agents, bound to {string}",
  async ({ person, world }, persona: Persona, agent: string) => {
    const owner = await person(persona);
    world.outcome = await attempt(async () => {
      const made = await owner.api.apiKeys.create.mutate({
        name: world.unique("bound-manage"),
        scopes: ["agents:manage"],
        agentIds: [world.agent(agent).id],
      });
      world.undo.push(() =>
        owner.api.apiKeys.revoke.mutate({ id: made.key.id }),
      );
      return made;
    });
  },
);

Then(
  "{word} is refused as not allowed",
  async ({ world }, _persona: Persona) => {
    expect(world.outcome?.refused, "the call was not refused").toBe(
      "FORBIDDEN",
    );
  },
);

Then(
  "{word} is refused as not signed in",
  async ({ world }, _persona: Persona) => {
    expect(world.outcome?.refused, "the call was not refused").toBe(
      "UNAUTHORIZED",
    );
  },
);

Then(
  "{word} is told a key that may manage agents covers every agent",
  async ({ world }, _persona: Persona) => {
    expect(world.outcome?.refused, "the key was made").toBe("BAD_REQUEST");
  },
);

Then(
  "{word} sees {string} through the key",
  async ({ world }, _persona: Persona, agent: string) => {
    expect(world.outcome?.refused).toBeUndefined();
    expect(world.outcome?.value).toContain(world.nameOf(agent));
  },
);

Then(
  "{word} sees the connection {string} through the key",
  async ({ world }, _persona: Persona, connection: string) => {
    expect(world.outcome?.refused).toBeUndefined();
    expect(world.outcome?.value).toContain(world.connection(connection).name);
  },
);

Then("the file is in {string}", async ({ world }, _agent: string) => {
  expect(world.outcome?.refused, "the upload was refused").toBeUndefined();
  expect(
    (world.outcome?.value as { mtimeMs?: number } | undefined)?.mtimeMs,
  ).toBeGreaterThan(0);
});

Then(
  "the API key {string} of {word} no longer names {string}",
  async ({ person, world }, name: string, persona: Persona, agent: string) => {
    const owner = await person(persona);
    const id = world.keys.get(name)!.id;
    const agentId = world.agent(agent).id;
    await expect
      .poll(async () => {
        const held = (await owner.api.apiKeys.list.query()).find(
          (k) => k.id === id,
        );
        return held?.agentIds === "*"
          ? true
          : !held?.agentIds.includes(agentId);
      })
      .toBe(true);
  },
);
