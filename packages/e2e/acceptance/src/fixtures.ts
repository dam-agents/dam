import { mkdirSync } from "node:fs";

import { type Browser, expect, type Page } from "@playwright/test";
import { test as base } from "playwright-bdd";

import { signInThroughTheBrowser } from "./auth.js";
import { mockTemplateId } from "./config.js";
import { apiDriver } from "./drivers/api/index.js";
import type { Driver, Surface } from "./drivers/driver.js";
import { uiDriver } from "./drivers/ui/index.js";
import type { Pages } from "./drivers/ui/pages.js";
import {
  type Persona,
  type Person,
  personas,
  preparePerson,
  warmMockAgent,
} from "./people.js";
import { customHeader, World } from "./world.js";

export type { Surface } from "./drivers/driver.js";

const mockReplyEnv = "MOCK_DEFAULT_REPLY";
const mockToolEnv = "MOCK_TOOL_CALL";

interface Cast {
  person(persona: Persona): Promise<Person>;
  storageState(persona: Persona): Promise<string>;
  warmAgent(persona: Persona, index: number): Promise<string>;
}

interface Setup {
  connection(
    persona: Persona,
    name: string,
    kind: { host: string; variable?: boolean } | { provider: "openai" },
  ): Promise<void>;
  grant(persona: Persona, connection: string, agent: string): Promise<void>;
  agent(persona: Persona, name: string): Promise<void>;
  sleep(agent: string): Promise<void>;
  runningAgent(
    persona: Persona,
    name: string,
    behaviour?: { answer?: string; publishes?: string },
  ): Promise<void>;
}

async function signIn(
  browser: Browser,
  person: Person,
  path: string,
): Promise<string> {
  const context = await browser.newContext();
  try {
    await signInThroughTheBrowser(
      await context.newPage(),
      person.account,
      person.acceptedTerms,
    );
    await context.storageState({ path });
  } finally {
    await context.close();
  }
  return path;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the fixtures every example and journey runs on. A worker owns the accounts of its parallel slot and signs each persona in once. The slot keeps booted mock Agents per persona, marked by their description, which the Given steps rename and script and later workers of the slot wake and reuse, so an example costs seconds instead of a machine boot. A Given step scripts an Agent through its environment, which every harness process the mock starts reads: its answer, `MOCK_DEFAULT_REPLY`, and a platform tool it calls on every turn, `MOCK_TOOL_CALL`; it sets the answer when the example names one, sets or clears the tool call on every warm Agent it takes, and waits until the Agent reports them. What a test makes beyond the warm Agents, connections and agents alike, is deleted when it ends, so a machine it booted does not hold its runner's memory. A test owns its World, its Driver, which the project's `surface` option picks, and one browser page per persona, which Playwright traces and a sign-in step replaces with a fresh one; a scenario tagged `@wip` is expected to fail until the behaviour it states exists; when it fails, a screenshot of each page, the World's evidence and the state of every Agent it named are attached to it.
 */
export const test = base.extend<
  {
    surface: Surface;
    world: World;
    setup: Setup;
    pages: Pages;
    wip: void;
    driver: Driver;
    person: (persona: Persona) => Promise<Person>;
  },
  { cast: Cast }
>({
  surface: ["api", { option: true }],

  cast: [
    async ({ browser }, use, workerInfo) => {
      const slot = workerInfo.parallelIndex;
      const people = new Map<Persona, Promise<Person>>();
      const states = new Map<Persona, Promise<string>>();
      const warm = new Map<Persona, string[]>();
      mkdirSync(".auth", { recursive: true });
      const person = (persona: Persona) => {
        if (!people.has(persona))
          people.set(persona, preparePerson(persona, slot));
        return people.get(persona)!;
      };
      await use({
        person,
        storageState: (persona) => {
          if (!states.has(persona))
            states.set(
              persona,
              person(persona).then((p) =>
                signIn(browser, p, `.auth/${p.account.username}.json`),
              ),
            );
          return states.get(persona)!;
        },
        warmAgent: async (persona, index) => {
          const agents = warm.get(persona) ?? [];
          warm.set(persona, agents);
          if (agents[index] === undefined)
            agents[index] = await warmMockAgent(await person(persona), index);
          return agents[index];
        },
      });
    },
    { scope: "worker", timeout: 600_000 },
  ],

  person: async ({ cast }, use) =>
    use((persona) => {
      if (!personas.includes(persona))
        throw new Error(
          `"${persona}" is no persona of the examples: use one of ${personas.join(", ")}`,
        );
      return cast.person(persona);
    }),

  world: async ({ cast }, use, testInfo) => {
    const world = new World();
    await use(world);
    if (testInfo.status === testInfo.expectedStatus) return;
    const agents = [];
    for (const record of world.agents.values()) {
      const owner = await cast.person(record.owner);
      agents.push(
        await owner.api.agents.get
          .query({ id: record.id })
          .catch((error: unknown) => ({ record, error: String(error) })),
      );
    }
    await testInfo.attach("evidence.json", {
      contentType: "application/json",
      body: JSON.stringify(
        { run: world.run, evidence: world.evidence, agents },
        null,
        2,
      ),
    });
  },

  setup: async ({ cast, world }, use) => {
    const allocated = new Map<Persona, number>();
    await use({
      connection: async (persona, name, kind) => {
        const owner = await cast.person(persona);
        const unique = world.unique(name);
        const made =
          "host" in kind
            ? await owner.api.connections.create.mutate(
                customHeader(world, name, kind.host, kind.variable),
              )
            : await owner.api.connections.create.mutate({
                templateId: kind.provider,
                name: unique,
                authKind: "header",
                value: "sk-acceptance-second-key",
              });
        world.connections.set(name, {
          owner: persona,
          name: unique,
          id: made.id,
        });
        world.made.push({ kind: "connection", owner: persona, id: made.id });
        world.note({
          step: "connection made",
          persona,
          name: unique,
          id: made.id,
        });
      },
      grant: async (persona, connection, agent) => {
        const owner = await cast.person(persona);
        const agentId = world.agent(agent).id;
        const connectionId = world.connection(connection).id;
        await owner.api.connections.updateAgentConnections.mutate({
          agentId,
          grant: [connectionId],
          revoke: [],
        });
        await expect
          .poll(
            async () =>
              (
                await owner.api.connections.getAgentConnections.query({
                  agentId,
                })
              ).connections.map((c) => c.connectionId),
            { timeout: 30_000, message: `${agent} never held ${connection}` },
          )
          .toContain(connectionId);
      },
      agent: async (persona, name) => {
        const owner = await cast.person(persona);
        const made = await owner.api.agents.create.mutate({
          name: world.unique(name),
          templateId: mockTemplateId,
        });
        world.agents.set(name, {
          owner: persona,
          name: made.name,
          id: made.id,
        });
        world.made.push({ kind: "agent", owner: persona, id: made.id });
        world.note({
          step: "agent made",
          persona,
          name: made.name,
          id: made.id,
        });
      },
      sleep: async (name) => {
        const agent = world.agent(name);
        const owner = await cast.person(agent.owner);
        await owner.api.agents.sleep.mutate({ id: agent.id });
        await expect
          .poll(
            async () =>
              (await owner.api.agents.get.query({ id: agent.id })).state,
            {
              timeout: 120_000,
              intervals: [1_000, 2_000],
              message: `${agent.name} did not fall asleep`,
            },
          )
          .toBe("hibernated");
        world.note({ step: "agent asleep", name: agent.name });
      },
      runningAgent: async (persona, name, { answer, publishes } = {}) => {
        const index = allocated.get(persona) ?? 0;
        allocated.set(persona, index + 1);
        const id = await cast.warmAgent(persona, index);
        const owner = await cast.person(persona);
        if ((await owner.api.agents.get.query({ id })).state !== "running") {
          await owner.api.agents.wake.mutate({ id });
          await expect
            .poll(
              async () => (await owner.api.agents.get.query({ id })).state,
              {
                timeout: 240_000,
                intervals: [1_000, 2_000],
                message: `${persona}'s warm agent did not wake`,
              },
            )
            .toBe("running");
        }
        const unique = world.unique(name);
        await owner.api.agents.update.mutate({ id, name: unique });
        const wanted = new Map<string, string | null>([
          ...(answer === undefined
            ? []
            : [[mockReplyEnv, world.unique(answer)] as [string, string]]),
          [
            mockToolEnv,
            publishes === undefined
              ? null
              : JSON.stringify({
                  name: "create_artifact",
                  arguments: {
                    title: world.unique(publishes),
                    content: `<h1>${world.unique(publishes)}</h1>`,
                    file_name: "artifact.html",
                    icon: "📄",
                  },
                }),
          ],
        ]);
        const env = (await owner.api.agents.get.query({ id })).env ?? [];
        await owner.api.agents.setEnv.mutate({
          id,
          env: [
            ...env.filter((v) => !wanted.has(v.name)),
            ...[...wanted]
              .filter(([, value]) => value !== null)
              .map(([envName, value]) => ({ name: envName, value: value! })),
          ],
        });
        for (const [envName, value] of wanted)
          await expect
            .poll(
              async () =>
                (
                  await owner.api.e2e.getEnv
                    .query({ agentId: id, name: envName })
                    .catch(() => undefined)
                )?.value ?? null,
              {
                timeout: 120_000,
                intervals: [250, 500, 1_000],
                message: `${persona}'s agent never took ${envName}`,
              },
            )
            .toBe(value);
        world.agents.set(name, { owner: persona, name: unique, id });
        world.note({ step: "agent ready", persona, name: unique, id });
      },
    });
    for (const item of world.made.reverse()) {
      const owner = await cast.person(item.owner);
      if (item.kind === "agent")
        await owner.api.agents.delete.mutate({ id: item.id }).catch(() => {});
      else
        await owner.api.connections.delete
          .mutate({ id: item.id })
          .catch(() => {});
    }
  },

  pages: async ({ browser, cast }, use, testInfo) => {
    const open = new Map<Persona, Page>();
    const pageIn = async (person: Person, storageState?: string) => {
      const page = await (await browser.newContext({ storageState })).newPage();
      await open.get(person.persona)?.context().close();
      open.set(person.persona, page);
      return page;
    };
    await use({
      of: async (person) =>
        open.get(person.persona) ??
        pageIn(person, await cast.storageState(person.persona)),
      fresh: (person) => pageIn(person),
    });
    const failed = testInfo.status !== testInfo.expectedStatus;
    for (const [persona, page] of open) {
      if (failed)
        await testInfo.attach(`${persona}-screenshot.png`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      await page.context().close();
    }
  },

  wip: [
    async ({}, use, testInfo) => {
      testInfo.fail(
        testInfo.tags.includes("@wip"),
        "@wip: expected to fail until the behaviour it states exists",
      );
      await use();
    },
    { auto: true },
  ],

  driver: async ({ surface, world, pages }, use) => {
    if (surface === "cli")
      throw new Error(
        "no CLI driver yet: tag no scenario @cli before it exists",
      );
    await use(
      surface === "ui" ? uiDriver(world, pages) : apiDriver(world, pages),
    );
  },
});
