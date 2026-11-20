import { expect, test } from "@playwright/test";

import type { World } from "../../world.js";
import type { AgentsDriver } from "../driver.js";
import { agentCard, openHome, type Pages } from "./pages.js";

export function uiAgents(world: World, pages: Pages): AgentsDriver {
  return {
    async lookAt(person) {
      const page = await pages.of(person);
      await openHome(page);
      const expand = page
        .getByTestId("app-sidebar")
        .getByRole("button", { name: "Expand navigation" });
      if (await expand.isVisible()) await expand.click();
      await expect(page.getByTestId("sidebar-agents")).toBeVisible();
    },
    async expectListed(person, name, listed) {
      const page = await pages.of(person);
      const row = page
        .getByTestId("sidebar-agents")
        .getByTestId("sidebar-agent-row")
        .filter({
          hasText: new RegExp(`^${world.nameOf(name)}\\s*(\\(unread\\))?$`),
        });
      if (listed) await expect(row).toBeVisible();
      else await expect(row).toHaveCount(0, { timeout: 120_000 });
    },
    async makeFromGeneralist(person, alias) {
      const page = await pages.of(person);
      await page
        .getByTestId("app-sidebar")
        .getByRole("button", { name: "Starter kits" })
        .click();
      await page.getByTestId("default-agent-card").click();
      await expect(page).toHaveURL(/\/chat\/[^/?#]+/);
      const id = decodeURIComponent(
        new URL(page.url()).pathname.split("/chat/")[1].split("/")[0],
      );
      const name = (
        await page.getByRole("heading", { level: 2 }).first().innerText()
      ).trim();
      world.agents.set(alias, { owner: person.persona, name, id });
      world.note({ step: "agent made in one click", alias, name, id });
    },
    async make() {
      test.skip(true, "the web UI makes an agent from a starter kit");
    },
    async expectProvider() {
      test.skip(true, "no UI driver for an agent's providers yet");
    },
    async remove(person, name) {
      const page = await pages.of(person);
      await openHome(page);
      await agentCard(page, world.nameOf(name))
        .getByRole("button", { name: "Agent settings" })
        .press("Enter");
      await page
        .getByRole("button", { name: "Delete", exact: true })
        .press("Enter");
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Delete agent" })
        .click();
    },
  };
}
