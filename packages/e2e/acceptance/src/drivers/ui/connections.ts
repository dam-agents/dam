import { expect, type Page, test } from "@playwright/test";

import { baseUrl } from "../../config.js";
import type { Person } from "../../people.js";
import { customHeader, type World } from "../../world.js";
import type { ConnectionsDriver } from "../driver.js";
import { openHome, type Pages, untilShown } from "./pages.js";

async function openOwnConnections(page: Page): Promise<void> {
  await openHome(page);
  await page
    .getByTestId("app-sidebar")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.getByRole("tab", { name: "Connections", exact: true }).click();
}

async function openAgentConnections(
  page: Page,
  agentId: string,
  agentName: string,
): Promise<void> {
  await page.goto(`${baseUrl}/sandboxes/${agentId}/connections`);
  await expect(
    page.getByRole("dialog", { name: `${agentName} settings` }),
  ).toBeVisible();
}

async function openCustomHeaders(page: Page): Promise<void> {
  await page.getByTestId("open-connection-catalog").first().click();
  await page.getByTestId("catalog-tab-custom-headers").click();
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the connections capability in the web UI: a person's own connections in Settings, and an agent's in its settings dialog, both through the connection catalog. A connection made from an agent's connections is granted to it by the page. The ids of what it makes come from the owner's listing, so the example removes them when it ends.
 */
export function uiConnections(world: World, pages: Pages): ConnectionsDriver {
  return {
    async lookAt(person) {
      await openOwnConnections(await pages.of(person));
    },
    async expectListed(person, name, listed) {
      const page = await pages.of(person);
      const shown = page.getByText(world.connections.get(name)?.name ?? name, {
        exact: true,
      });
      if (listed) await expect(shown.first()).toBeVisible();
      else await expect(shown).toHaveCount(0);
    },
    async grant() {
      test.skip(true, "no UI driver for granting a connection yet");
    },
    async expectGrantRefused() {
      test.skip(true, "no UI driver for granting a connection yet");
    },
    async make(person, name, host, forAgent) {
      const page = await pages.of(person);
      if (forAgent === undefined) await openOwnConnections(page);
      else {
        const agent = world.agent(forAgent);
        await openAgentConnections(page, agent.id, agent.name);
      }
      await openCustomHeaders(page);
      await page
        .getByRole("dialog")
        .getByTestId("catalog-new-custom-header")
        .click();
      const shareConfirm = page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Add connection" });
      const nameField = page.getByTestId("connection-field-name");
      await expect(shareConfirm.or(nameField)).toBeVisible();
      if (await shareConfirm.isVisible()) await shareConfirm.click();
      const input = customHeader(world, name, host);
      await nameField.fill(input.name);
      await page.getByTestId("connection-field-host").fill(input.host);
      await page
        .getByTestId("connection-field-headerName")
        .fill(input.headerName);
      await page
        .getByTestId("connection-field-valueFormat")
        .fill(input.valueFormat);
      await page.getByTestId("connection-field-value").fill(input.value);
      await page.getByTestId("connection-field-envName").fill(input.envName!);
      await page.getByTestId("connection-create-submit").click();
      await expect(page.getByTestId("catalog-close")).toBeHidden();
      const made = (await person.api.connections.list.query()).find(
        (c) => c.name === input.name,
      );
      expect(made, `${input.name} was not made`).toBeDefined();
      world.connections.set(name, {
        owner: person.persona,
        name: input.name,
        id: made!.id,
      });
      world.made.push({
        kind: "connection",
        owner: person.persona,
        id: made!.id,
      });
      world.note({ step: "connection made", name, id: made!.id, forAgent });
    },
    async remove(person, name) {
      const page = await pages.of(person);
      const { id } = world.connection(name);
      await openOwnConnections(page);
      await openCustomHeaders(page);
      const card = page
        .getByRole("dialog")
        .getByTestId("catalog-provider-custom-header");
      await card.getByTestId(`catalog-menu-${id}`).click();
      await page
        .getByRole("menuitem", { name: "Delete this connection" })
        .click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Delete connection" })
        .click();
      await expect(card.getByTestId(`catalog-connection-${id}`)).toHaveCount(0);
    },
    async replaceSecret() {
      test.skip(true, "no UI driver for replacing a secret yet");
    },
    async expectHeld(person: Person, connectionName, agentName, held) {
      const page = await pages.of(person);
      const agent = world.agent(agentName);
      const row = page.getByTestId(
        `catalog-connection-${world.connection(connectionName).id}`,
      );
      await untilShown(
        page,
        () => openAgentConnections(page, agent.id, agent.name),
        row,
        held,
        180_000,
      );
    },
  };
}
