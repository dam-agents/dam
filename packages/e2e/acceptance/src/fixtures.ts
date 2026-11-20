import { mkdirSync } from "node:fs";

import { type Browser, expect, type Page } from "@playwright/test";
import { test as base } from "playwright-bdd";

import { signInThroughTheBrowser } from "./auth.js";
import { ApiDriver } from "./drivers/api-driver.js";
import type { Driver } from "./drivers/driver.js";
import { UiDriver } from "./drivers/ui-driver.js";
import {
  type Persona,
  type Person,
  personas,
  preparePerson,
  warmMockAgent,
} from "./people.js";
import { World } from "./world.js";

export type Surface = "api" | "ui";

const mockReplyEnv = "MOCK_DEFAULT_REPLY";

interface Cast {
  person(persona: Persona): Promise<Person>;
  storageState(persona: Persona): Promise<string>;
  warmAgent(persona: Persona, index: number): Promise<string>;
}

interface Setup {
  runningAgent(
    persona: Persona,
    name: string,
    answer: string | undefined,
  ): Promise<void>;
}

async function signIn(
  browser: Browser,
  person: Person,
  path: string,
): Promise<string> {
  const context = await browser.newContext();
  try {
    await signInThroughTheBrowser(await context.newPage(), person.account);
    await context.storageState({ path });
  } finally {
    await context.close();
  }
  return path;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the fixtures every example and journey runs on. A worker owns the accounts of its parallel slot and signs each persona in once. The slot keeps booted mock Agents per persona, marked by their description, which the Given steps rename and script and later workers of the slot wake and reuse, so an example costs seconds instead of a machine boot. A Given step scripts an Agent's answer through its environment, `MOCK_DEFAULT_REPLY`, which every harness process the mock starts reads, and waits until the Agent reports it. A test owns its World, its Driver, which the project's `surface` option picks, and one browser page per persona, which Playwright traces; when it fails, a screenshot of each page, the World's evidence and the state of every Agent it named are attached to it.
 */
export const test = base.extend<
  {
    surface: Surface;
    world: World;
    setup: Setup;
    pageOf: (person: Person) => Promise<Page>;
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
      runningAgent: async (persona, name, answer) => {
        const index = allocated.get(persona) ?? 0;
        allocated.set(persona, index + 1);
        const id = await cast.warmAgent(persona, index);
        const owner = await cast.person(persona);
        const unique = world.unique(name);
        await owner.api.agents.update.mutate({ id, name: unique });
        if (answer !== undefined) {
          const reply = world.unique(answer);
          const env = (await owner.api.agents.get.query({ id })).env ?? [];
          await owner.api.agents.setEnv.mutate({
            id,
            env: [
              ...env.filter((v) => v.name !== mockReplyEnv),
              { name: mockReplyEnv, value: reply },
            ],
          });
          await expect
            .poll(
              async () =>
                (
                  await owner.api.e2e.getEnv
                    .query({ agentId: id, name: mockReplyEnv })
                    .catch(() => undefined)
                )?.value,
              {
                timeout: 120_000,
                intervals: [250, 500, 1_000],
                message: `${persona}'s agent never took its answer`,
              },
            )
            .toBe(reply);
        }
        world.agents.set(name, { owner: persona, name: unique, id });
        world.note({ step: "agent ready", persona, name: unique, id });
      },
    });
  },

  pageOf: async ({ browser, cast }, use, testInfo) => {
    const pages = new Map<Persona, Page>();
    await use(async (person) => {
      const open = pages.get(person.persona);
      if (open) return open;
      const context = await browser.newContext({
        storageState: await cast.storageState(person.persona),
      });
      const page = await context.newPage();
      pages.set(person.persona, page);
      return page;
    });
    const failed = testInfo.status !== testInfo.expectedStatus;
    for (const [persona, page] of pages) {
      if (failed)
        await testInfo.attach(`${persona}-screenshot.png`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      await page.context().close();
    }
  },

  driver: async ({ surface, world, pageOf }, use) =>
    use(surface === "ui" ? new UiDriver(world, pageOf) : new ApiDriver(world)),
});
