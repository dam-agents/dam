import { expect } from "@playwright/test";

import {
  type BrowserSnapshot,
  type BrowserWatch,
  browserControl,
  watchBrowser,
} from "../../browser.js";
import type { Person } from "../../people.js";
import type { World } from "../../world.js";
import type { BrowserDriver } from "../driver.js";

const syncMs = 20_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: an agent's browser over the agent's tRPC relay, as the web UI's panel drives it: a watch reports its tabs and the tab in front, and the browser control selects, opens, closes and navigates tabs. Tabs are found by their titles, which the examples make unique to the run; a refused control call is kept as the example's outcome.
 */
export function apiBrowser(world: World): BrowserDriver {
  const watches = new Map<string, BrowserWatch>();
  const watchOf = async (person: Person, agentName: string) => {
    let watch = watches.get(agentName);
    if (watch === undefined) {
      watch = await watchBrowser(person, world.agent(agentName).id);
      watches.set(agentName, watch);
      world.closers.push(watch.close);
    }
    return watch;
  };
  const ready = async (
    person: Person,
    agentName: string,
  ): Promise<BrowserSnapshot> => {
    const watch = await watchOf(person, agentName);
    await expect
      .poll(() => watch.refusal() ?? watch.latest()?.state, {
        timeout: 120_000,
        message: `the browser of ${agentName} never came up`,
      })
      .toBe("ready");
    return watch.latest()!;
  };
  const tabId = async (person: Person, agentName: string, title: string) => {
    const tab = (await ready(person, agentName)).tabs.find(
      (t) => t.title === world.unique(title),
    );
    expect(
      tab,
      `the browser of ${agentName} has no tab "${title}"`,
    ).toBeDefined();
    return tab!.id;
  };
  const control = async (
    person: Person,
    agentName: string,
    procedure: Parameters<typeof browserControl>[2],
    input?: object,
  ) => {
    const outcome = await browserControl(
      person,
      world.agent(agentName).id,
      procedure,
      input,
    );
    world.outcome = {
      value: outcome.data,
      refused: outcome.code,
      message: outcome.message,
    };
    world.note({ step: "browser control", agentName, procedure, outcome });
    return outcome;
  };
  return {
    async open(person, agentName) {
      const watch = await watchOf(person, agentName);
      const agentId = world.agent(agentName).id;
      await expect
        .poll(
          async () => {
            if (watch.latest()?.state === "ready") return "ready";
            const probe = await browserControl(person, agentId, "selectTab", {
              tab: "none",
            });
            return probe.code === "FORBIDDEN" ? "not offered" : "starting";
          },
          { timeout: 120_000, intervals: [3_000] },
        )
        .toMatch(/^(ready|not offered)$/);
    },
    async expectNotOffered(person, agentName) {
      const outcome = await control(person, agentName, "selectTab", {
        tab: "none",
      });
      expect(outcome.code).toBe("FORBIDDEN");
      expect(outcome.message).toMatch(/require named connections/);
    },
    async expectTabs(person, agentName, count) {
      await ready(person, agentName);
      const watch = await watchOf(person, agentName);
      await expect
        .poll(() => watch.latest()?.tabs.length, { timeout: syncMs })
        .toBe(count);
    },
    async expectFront(person, agentName, title) {
      await ready(person, agentName);
      const watch = await watchOf(person, agentName);
      await expect
        .poll(
          () => {
            const snapshot = watch.latest()!;
            const front = snapshot.tabs.find(
              (t) => t.id === snapshot.activeTab,
            );
            return title === undefined ? front?.url : front?.title;
          },
          { timeout: syncMs },
        )
        .toBe(title === undefined ? "about:blank" : world.unique(title));
    },
    async expectGone(person, agentName, title) {
      await ready(person, agentName);
      const watch = await watchOf(person, agentName);
      await expect
        .poll(
          () =>
            watch.latest()!.tabs.some((t) => t.title === world.unique(title)),
          {
            timeout: syncMs,
          },
        )
        .toBe(false);
    },
    async newTab(person, agentName) {
      await ready(person, agentName);
      await control(person, agentName, "newTab");
    },
    async bringToFront(person, agentName, title) {
      const tab =
        world.browserTabs.get(`${agentName}/${title}`) ??
        (await tabId(person, agentName, title));
      await control(person, agentName, "selectTab", { tab });
    },
    async close(person, agentName, title) {
      const snapshot = await ready(person, agentName);
      const tab =
        title === undefined
          ? snapshot.activeTab
          : await tabId(person, agentName, title);
      await control(person, agentName, "closeTab", { tab });
    },
    async goTo(person, agentName, url) {
      await ready(person, agentName);
      await control(person, agentName, "navigate", { url });
    },
  };
}
