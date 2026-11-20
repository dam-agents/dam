import { expect, type Page } from "@playwright/test";

import { baseUrl } from "../../config.js";
import type { World } from "../../world.js";
import type { SessionsDriver } from "../driver.js";
import type { Pages } from "./pages.js";

function sessionRow(page: Page, title: string) {
  return page.getByTestId("session-row").filter({ hasText: title });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an agent's sessions in the web UI: the sidebar lists them under the agent whose chat is shown, and a row's menu deletes one. A person's page stays where it is unless it shows no chat of the agent, so a session deleted beside the open one leaves that one on screen.
 */
export function uiSessions(world: World, pages: Pages): SessionsDriver {
  const showAgent = async (page: Page, agentName: string) => {
    const { id } = world.agent(agentName);
    if (!new URL(page.url()).pathname.startsWith(`/chat/${id}`))
      await page.goto(`${baseUrl}/chat/${id}`);
  };
  return {
    async expectListed(person, agentName, text, listed) {
      const page = await pages.of(person);
      await showAgent(page, agentName);
      const row = sessionRow(page, world.unique(text));
      if (listed) await expect(row).toBeVisible({ timeout: 30_000 });
      else await expect(row).toHaveCount(0, { timeout: 30_000 });
    },
    async remove(person, agentName, text) {
      const page = await pages.of(person);
      await showAgent(page, agentName);
      const row = sessionRow(page, world.unique(text));
      await row.hover();
      await row.getByTestId("session-menu-button").click();
      await page.getByTestId("session-delete-button").click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Delete session" })
        .click();
      await expect(page.getByText("Session deleted")).toBeVisible();
    },
    async expectStillOpen(person, agentName, text) {
      const page = await pages.of(person);
      const { id } = world.agent(agentName);
      const session = world.session(text);
      await expect(page).toHaveURL(
        new RegExp(`/chat/${id}/${encodeURIComponent(session.id)}`),
      );
      await expect(
        page
          .getByTestId("chat-message")
          .getByText(session.title, { exact: true }),
      ).toBeVisible();
    },
  };
}
