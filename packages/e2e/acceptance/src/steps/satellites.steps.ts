import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

import { promptOnce } from "../acp.js";
import { test } from "../fixtures.js";
import { attempt } from "../keys.js";
import type { Person, Persona } from "../people.js";
import { connectMachine, scopedTool } from "../satellites.js";
import type { World } from "../world.js";

const { Given, When, Then } = createBdd(test);

/** UNIT_BOUNDARY_DESCRIPTION: the machine and tools each satellite of an example connected with, so a Then can name only the satellite. */
const machines = new WeakMap<
  World,
  Map<string, { host: string; tools: string[] }>
>();

function connected(
  world: World,
): Map<string, { host: string; tools: string[] }> {
  if (!machines.has(world)) machines.set(world, new Map());
  return machines.get(world)!;
}

const toolsOf = (list: string) => list.split(/,\s*/);

for (const [phrase, maxConcurrent] of [
  [
    "{word}'s machine {string} has connected the satellite {string} offering {string}",
    undefined,
  ],
  [
    "{word}'s machine {string} has connected the satellite {string} offering {string} one call at a time",
    1,
  ],
] as const)
  Given(
    phrase,
    async (
      { person, world },
      persona: Persona,
      host: string,
      name: string,
      tools: string,
    ) => {
      await connectMachine(
        world,
        await person(persona),
        name,
        host,
        toolsOf(tools),
        maxConcurrent,
      );
      connected(world).set(name, { host, tools: toolsOf(tools) });
    },
  );

Given(
  "{word} has connected no satellite",
  async ({ person }, persona: Persona) => {
    const owner = await person(persona);
    for (const s of await owner.api.satellites.list.query())
      await owner.api.satellites.remove.mutate(s.name);
  },
);

Given(
  "{word} has granted the satellite {string} to {string}",
  async (
    { person, world },
    persona: Persona,
    satellite: string,
    agent: string,
  ) =>
    (await person(persona)).api.satellites.grant.mutate({
      satellite: world.unique(satellite),
      agentId: world.agent(agent).id,
    }),
);

Given(
  "{word} has a running agent called {string} that calls {string} on the satellite {string}",
  async (
    { setup, world },
    persona: Persona,
    name: string,
    tool: string,
    satellite: string,
  ) =>
    setup.runningAgent(persona, name, {
      calls: { name: scopedTool(world.unique(satellite), tool), arguments: {} },
    }),
);

Given(
  "{string} has a job waiting on {string}",
  async ({ person, world }, agent: string, satellite: string) => {
    const record = world.agent(agent);
    const owner = await person(record.owner);
    const turn = await promptOnce(
      record.id,
      await owner.token(),
      world.unique("build it"),
    );
    world.opened(record.owner, agent, "build it", turn.sessionId);
    await expect
      .poll(
        async () =>
          (
            await owner.api.satellites.jobs.query(world.unique(satellite))
          ).filter((j) => j.status === "queued").length,
        {
          timeout: 60_000,
          message: `no job of ${agent} waits on ${satellite}`,
        },
      )
      .toBeGreaterThan(0);
  },
);

for (const [given, when] of [
  [
    "{word}'s machine {string} has started shutting down the satellite {string}",
    "{word}'s machine {string} starts shutting down the satellite {string}",
  ],
] as const) {
  const drain = async (world: World, owner: Person, name: string) =>
    owner.api.satellites.drain.mutate(world.unique(name));
  Given(
    given,
    async ({ person, world }, persona: Persona, _host: string, name: string) =>
      drain(world, await person(persona), name),
  );
  When(
    when,
    async ({ person, world }, persona: Persona, _host: string, name: string) =>
      drain(world, await person(persona), name),
  );
}

When(
  "{word}'s machine {string} connects the satellite {string} offering {string}",
  async (
    { person, world },
    persona: Persona,
    host: string,
    name: string,
    tools: string,
  ) => {
    const owner = await person(persona);
    world.outcome = await attempt(() =>
      connectMachine(world, owner, name, host, toolsOf(tools)),
    );
    connected(world).set(name, { host, tools: toolsOf(tools) });
  },
);

When(
  "{word}'s machine {string} connects the satellite {string} again offering {string}",
  async (
    { person, world },
    persona: Persona,
    host: string,
    name: string,
    tools: string,
  ) => {
    await connectMachine(
      world,
      await person(persona),
      name,
      host,
      toolsOf(tools),
    );
    connected(world).set(name, { host, tools: toolsOf(tools) });
  },
);

When(
  "{word} grants the satellite {string} to {string}",
  async (
    { driver, person },
    persona: Persona,
    satellite: string,
    agent: string,
  ) => driver.satellites.grant(await person(persona), satellite, agent),
);

When(
  "{word} revokes the satellite {string} from {string}",
  async (
    { driver, person },
    persona: Persona,
    satellite: string,
    agent: string,
  ) => driver.satellites.revoke(await person(persona), satellite, agent),
);

When(
  "{word} removes the satellite {string}",
  async ({ driver, person }, persona: Persona, satellite: string) =>
    driver.satellites.remove(await person(persona), satellite),
);

When(
  "{word} looks at the satellites",
  async ({ driver, person }, persona: Persona) =>
    driver.satellites.lookAt(await person(persona)),
);

Then(
  "{word} sees the satellite {string} online on {string} offering {string}",
  async (
    { driver, person },
    persona: Persona,
    name: string,
    host: string,
    tools: string,
  ) =>
    driver.satellites.expectListed(await person(persona), name, {
      host,
      tools: toolsOf(tools),
      state: "online",
    }),
);

Then(
  "{word} sees the satellite {string} shutting down",
  async ({ driver, person, world }, persona: Persona, name: string) => {
    const machine = connected(world).get(name);
    expect(machine, `no machine connected ${name}`).toBeDefined();
    await driver.satellites.expectListed(await person(persona), name, {
      ...machine!,
      state: "shutting down",
    });
  },
);

Then(
  "{word} does not see a satellite called {string}",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.satellites.expectListed(await person(persona), name, undefined),
);

Then(
  "{word} sees no satellites",
  async ({ driver, person }, persona: Persona) =>
    driver.satellites.expectNone(await person(persona)),
);

Then(
  "{word} is told there is no satellite called {string}",
  async ({ world }, _persona: Persona, name: string) => {
    expect(world.outcome?.value, "the grant was accepted").toBeUndefined();
    expect(world.outcome?.message).toContain(
      `no satellite "${world.unique(name)}"`,
    );
  },
);

Then(
  "{word} sees that {string} holds the satellite {string}",
  async (
    { driver, person },
    persona: Persona,
    agent: string,
    satellite: string,
  ) =>
    driver.satellites.expectHeld(await person(persona), satellite, agent, true),
);

Then(
  "{word} sees that {string} does not hold the satellite {string}",
  async (
    { driver, person },
    persona: Persona,
    agent: string,
    satellite: string,
  ) =>
    driver.satellites.expectHeld(
      await person(persona),
      satellite,
      agent,
      false,
    ),
);

Then(
  "{word} sees the job {string} of {string} {word}",
  async (
    { person, world },
    persona: Persona,
    ref: string,
    agent: string,
    status: string,
  ) => {
    const [satellite, sequence] = ref.split("#");
    const owner = await person(persona);
    await expect
      .poll(
        async () =>
          (
            await owner.api.satellites.jobs.query(world.unique(satellite!))
          ).find(
            (j) =>
              j.sequence === Number(sequence) &&
              j.agentId === world.agent(agent).id,
          )?.status,
        { timeout: 60_000, message: `${ref} of ${agent} is not ${status}` },
      )
      .toBe(status);
  },
);

Then(
  "{word} sees no job on {string}",
  async ({ person, world }, persona: Persona, satellite: string) => {
    const owner = await person(persona);
    expect(
      await owner.api.satellites.jobs.query(world.unique(satellite)),
    ).toEqual([]);
  },
);

Then(
  "{word}'s machine is told it may not offer a tool called {string}",
  async ({ world }, _persona: Persona, _tool: string) => {
    expect(world.outcome?.value, "the satellite connected").toBeUndefined();
    expect(world.outcome?.message).toMatch(/may not be named/);
  },
);
