import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

import { test } from "../fixtures.js";
import type { Persona } from "../people.js";

const { Given, When, Then } = createBdd(test);

const listOf = (titles: string) => titles.split(/,\s*/);

const titled = (unique: string) =>
  `agent-browser tab new about:blank && agent-browser eval 'document.title="${unique}"'`;

Given(
  "{word} has a running agent called {string} that opens a page titled {string}",
  async ({ setup, world }, persona: Persona, name: string, title: string) =>
    setup.runningAgent(persona, name, { shell: titled(world.unique(title)) }),
);

Given(
  "{word} has a running agent called {string} that answers with the title of its page",
  async ({ setup }, persona: Persona, name: string) =>
    setup.runningAgent(persona, name, {
      shell: "agent-browser eval document.title",
    }),
);

Given("the browser of {string} is fresh", async ({ setup }, agent: string) =>
  setup.freshBrowser(agent),
);

Given(
  "the browser of {string} has the tabs {string}, with {string} in front",
  async ({ setup }, agent: string, titles: string, front: string) =>
    setup.browserTabs(agent, listOf(titles), front),
);

Given(
  "the tab {string} of the browser of {string} has since closed",
  async ({ setup }, title: string, agent: string) =>
    setup.closedTab(agent, title),
);

Given(
  "{word} has the browser of {string} open",
  async ({ driver, person }, persona: Persona, agent: string) =>
    driver.browser.open(await person(persona), agent),
);

Given(
  "{word} has brought {string} to the front of the browser of {string}",
  async (
    { driver, person },
    persona: Persona,
    title: string,
    agent: string,
  ) => {
    const someone = await person(persona);
    await driver.browser.open(someone, agent);
    await driver.browser.bringToFront(someone, agent, title);
    await driver.browser.expectFront(someone, agent, title);
  },
);

Given(
  "{word} has sent {string} to {string}",
  async ({ driver, person }, persona: Persona, text: string, agent: string) =>
    driver.chat.send(await person(persona), agent, text),
);

When(
  "{word} opens the browser of {string}",
  async ({ driver, person }, persona: Persona, agent: string) =>
    driver.browser.open(await person(persona), agent),
);

When(
  "{word} opens a new tab in the browser of {string}",
  async ({ driver, person }, persona: Persona, agent: string) =>
    driver.browser.newTab(await person(persona), agent),
);

When(
  "{word} brings {string} to the front of the browser of {string}",
  async ({ driver, person }, persona: Persona, title: string, agent: string) =>
    driver.browser.bringToFront(await person(persona), agent, title),
);

When(
  "{word} closes the tab {string} in the browser of {string}",
  async ({ driver, person }, persona: Persona, title: string, agent: string) =>
    driver.browser.close(await person(persona), agent, title),
);

When(
  "{word} closes the tab in front in the browser of {string}",
  async ({ driver, person }, persona: Persona, agent: string) =>
    driver.browser.close(await person(persona), agent, undefined),
);

When(
  "{word} goes to {string} in the browser of {string}",
  async ({ driver, person }, persona: Persona, url: string, agent: string) =>
    driver.browser.goTo(await person(persona), agent, url),
);

Then(
  "{word} is not offered the browser of {string}",
  async ({ driver, person }, persona: Persona, agent: string) =>
    driver.browser.expectNotOffered(await person(persona), agent),
);

Then(
  "{word} sees the browser of {string} with {int} tab(s)",
  async ({ driver, person }, persona: Persona, agent: string, count: number) =>
    driver.browser.expectTabs(await person(persona), agent, count),
);

Then(
  "{word} sees {string} in front in the browser of {string}",
  async ({ driver, person }, persona: Persona, title: string, agent: string) =>
    driver.browser.expectFront(await person(persona), agent, title),
);

Then(
  "{word} sees a blank tab in front in the browser of {string}",
  async ({ driver, person }, persona: Persona, agent: string) =>
    driver.browser.expectFront(await person(persona), agent, undefined),
);

Then(
  "{word} does not see the tab {string} in the browser of {string}",
  async ({ driver, person }, persona: Persona, title: string, agent: string) =>
    driver.browser.expectGone(await person(persona), agent, title),
);

Then(
  "{word} is told only http and https addresses open",
  async ({ world }, _persona: Persona) => {
    expect(world.outcome?.refused).toBe("BAD_REQUEST");
    expect(world.outcome?.message).toMatch(
      /Only http and https addresses open/,
    );
  },
);

Then(
  "{word} is told the tab is closed",
  async ({ world }, _persona: Persona) => {
    expect(world.outcome?.refused).toBe("NOT_FOUND");
    expect(world.outcome?.message).toMatch(/That tab is closed/);
  },
);
