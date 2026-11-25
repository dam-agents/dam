import { expect, type Page } from "@playwright/test";

import { baseUrl } from "../../config.js";
import type { World } from "../../world.js";
import type { SatellitesDriver } from "../driver.js";
import { type Pages, untilShown } from "./pages.js";

async function openConnections(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/settings/connections`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Connections" }),
  ).toBeVisible();
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an owner's satellites in the web UI: listed under Connections in Settings once one has connected, with the number of its tools and its host, added to an agent from its connection catalog, taken back or removed from a row's actions.
 */
export function uiSatellites(world: World, pages: Pages): SatellitesDriver {
  const openAgent = async (page: Page, agentName: string) => {
    const agent = world.agent(agentName);
    await page.goto(`${baseUrl}/sandboxes/${agent.id}/connections`);
    await expect(
      page.getByRole("dialog", { name: `${agent.name} settings` }),
    ).toBeVisible();
  };
  return {
    async lookAt(person) {
      await openConnections(await pages.of(person));
    },
    async expectListed(person, name, view) {
      const page = await pages.of(person);
      const row = page.getByTestId(`satellite-${world.unique(name)}`);
      if (view === undefined) {
        await untilShown(page, () => openConnections(page), row, false);
        return;
      }
      await openConnections(page);
      const listed = page
        .getByTestId("connection-group-satellites")
        .getByTestId(`satellite-${world.unique(name)}`);
      await expect(listed).toBeVisible();
      await expect(listed).toContainText(view.host);
      await expect(listed).toContainText(
        view.tools.length === 1 ? "1 tool" : `${view.tools.length} tools`,
      );
      if (view.state === "shutting down")
        await expect(listed).toContainText("Shutting down");
      else await expect(listed).not.toContainText(/Offline|Shutting down/);
    },
    async expectNone(person) {
      const page = await pages.of(person);
      await openConnections(page);
      await expect(page.getByTestId("connection-group-satellites")).toHaveCount(
        0,
      );
    },
    async grant(person, satellite, agentName) {
      const page = await pages.of(person);
      await openAgent(page, agentName);
      await page.getByTestId("open-connection-catalog").first().click();
      await page.getByTestId("catalog-tab-mcp").click();
      await page
        .getByTestId(`catalog-add-satellite-${world.unique(satellite)}`)
        .click();
      await expect(page.getByText("In this agent")).toBeVisible();
    },
    async revoke(person, satellite, agentName) {
      const page = await pages.of(person);
      await openAgent(page, agentName);
      await page
        .getByRole("button", { name: `Actions for ${world.unique(satellite)}` })
        .first()
        .click();
      await page
        .getByRole("menuitem", { name: "Remove from this agent" })
        .click();
    },
    async expectHeld(person, satellite, agentName, held) {
      const page = await pages.of(person);
      await untilShown(
        page,
        () => openAgent(page, agentName),
        page.getByTestId(`satellite-${world.unique(satellite)}`),
        held,
      );
    },
    async remove(person, satellite) {
      const page = await pages.of(person);
      await openConnections(page);
      await page
        .getByRole("button", { name: `Actions for ${world.unique(satellite)}` })
        .first()
        .click();
      await page
        .getByRole("menuitem", { name: "Remove this satellite" })
        .click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Remove satellite" })
        .click();
    },
  };
}
