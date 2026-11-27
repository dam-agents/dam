import { expect, type Page, test } from "@playwright/test";

import { baseUrl } from "../../config.js";
import type { World } from "../../world.js";
import type { BrowserDriver } from "../driver.js";
import type { Pages } from "./pages.js";

const syncMs = 45_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: an agent's browser in the web UI: the panel beside the agent's chat, opened from the agent's menu, whose tab bar shows from two tabs on and whose top bar holds the new-tab button. A tab is found by its title. Closing the only tab and the refusals of the browser control are not reachable from the panel, so those checks skip here.
 */
export function uiBrowser(world: World, pages: Pages): BrowserDriver {
  const tabs = (page: Page) =>
    page.getByTestId("browser-tabs").getByRole("tab");
  const openPanel = async (page: Page, agentName: string) => {
    const agent = world.agent(agentName);
    await page.goto(`${baseUrl}/chat/${agent.id}`);
    await page.getByTestId("chat-agent-identity").click();
  };
  const address = (page: Page) =>
    page.getByLabel("Address in the agent's browser");
  const panelOf = async (
    person: Parameters<BrowserDriver["open"]>[0],
    agentName: string,
  ) => {
    const page = await pages.of(person);
    if (!(await address(page).isVisible()))
      await openBrowser(person, agentName);
    return page;
  };
  const openBrowser = async (
    person: Parameters<BrowserDriver["open"]>[0],
    agentName: string,
  ) => {
    const page = await pages.of(person);
    await openPanel(page, agentName);
    const entry = page.getByRole("menuitem", { name: "Browser" });
    if ((await entry.count()) === 0) return;
    await entry.click();
    await expect(page.getByLabel("Address in the agent's browser")).toBeVisible(
      {
        timeout: 120_000,
      },
    );
    await expect(page.getByText(/Starting the agent's browser/)).toHaveCount(
      0,
      {
        timeout: 120_000,
      },
    );
  };
  return {
    open: openBrowser,
    async expectNotOffered(person) {
      const page = await pages.of(person);
      await expect(page.getByRole("menuitem", { name: "Browser" })).toHaveCount(
        0,
      );
    },
    async expectTabs(person, agentName, count) {
      const page = await panelOf(person, agentName);
      if (count === 1) {
        await expect(page.getByTestId("browser-tabs")).toHaveCount(0, {
          timeout: syncMs,
        });
        await expect(
          page.getByRole("button", { name: "New tab", exact: true }),
        ).toBeVisible();
      } else await expect(tabs(page)).toHaveCount(count, { timeout: syncMs });
    },
    async expectFront(person, agentName, title) {
      const page = await panelOf(person, agentName);
      await expect(
        tabs(page).and(page.locator('[aria-selected="true"]')),
      ).toContainText(title === undefined ? "New tab" : world.unique(title), {
        timeout: syncMs,
      });
    },
    async expectGone(person, agentName, title) {
      const page = await panelOf(person, agentName);
      await expect(
        tabs(page).filter({ hasText: world.unique(title) }),
      ).toHaveCount(0, {
        timeout: syncMs,
      });
    },
    async newTab(person, agentName) {
      const page = await panelOf(person, agentName);
      await page.getByRole("button", { name: "New tab", exact: true }).click();
    },
    async bringToFront(person, agentName, title) {
      const page = await panelOf(person, agentName);
      await tabs(page)
        .filter({ hasText: world.unique(title) })
        .click();
    },
    async close(person, agentName, title) {
      if (title === undefined)
        test.skip(
          true,
          "the panel shows no tab bar, so no close button, for the only tab",
        );
      const page = await panelOf(person, agentName);
      await page
        .getByRole("button", { name: `Close tab ${world.unique(title!)}` })
        .click();
    },
    async goTo() {
      test.skip(
        true,
        "a refused address is the browser control's answer, not the panel's",
      );
    },
  };
}
