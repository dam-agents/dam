import { expect, type Page } from "@playwright/test";

import type { World } from "../../world.js";
import type { SessionsDriver } from "../driver.js";
import { agentSessionRows, showAgentView } from "./nav.js";
import type { Pages } from "./pages.js";

function sessionRow(page: Page, title: string) {
  return agentSessionRows(page).filter({ hasText: title });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an agent's sessions in the web UI: the left nav lists them in the agent's own view, and a row's menu deletes one. Entering that view opens the agent's new-session page, so a person who had a session of the agent open opens it again from the list, as they would by hand, and a session deleted beside it leaves it on screen.
 */
export function uiSessions(world: World, pages: Pages): SessionsDriver {
  const showAgent = async (page: Page, agentName: string) => {
    const { id } = world.agent(agentName);
    const open = new URL(page.url()).pathname.match(
      new RegExp(`^/chat/${id}/([^/]+)`),
    )?.[1];
    if (!(await showAgentView(page, id)) || !open) return;
    const session = [...world.sessions.values()].find(
      (s) => s.id === decodeURIComponent(open),
    );
    if (!session) return;
    await sessionRow(page, session.title).click();
    await expect(page).toHaveURL(new RegExp(`/chat/${id}/${open}`));
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
