import { expect, type Locator, type Page } from "@playwright/test";

import { openHome } from "./pages.js";

const allAgents = (page: Page) => page.getByTestId("sidebar-all-agents");

export function agentRows(page: Page): Locator {
  return page.getByTestId("sidebar-agents").getByTestId("sidebar-agent-row");
}

async function showNav(page: Page): Promise<void> {
  if (!new URL(page.url()).pathname.startsWith("/chat/")) await openHome(page);
  const expand = page
    .getByTestId("app-sidebar")
    .getByRole("button", { name: "Expand navigation" });
  if (await expand.isVisible()) await expand.click();
  await expect(page.getByTestId("sidebar-agents")).toBeVisible();
}

/** UNIT_BOUNDARY_DESCRIPTION: the left nav listing every agent, its default view: a page that shows one agent's view goes back with All agents. */
export async function showAllAgents(page: Page): Promise<void> {
  await showNav(page);
  if (await allAgents(page).isVisible()) await allAgents(page).click();
  await expect(allAgents(page)).toBeHidden();
}

/** UNIT_BOUNDARY_DESCRIPTION: the left nav showing one agent and its own sessions, the view a click on the agent opens. The click also opens the agent's new-session page, so a caller that needs a session open opens it from the list afterwards. Returns whether the page had to enter the view. */
export async function showAgentView(
  page: Page,
  agentId: string,
): Promise<boolean> {
  await showNav(page);
  if (await allAgents(page).isVisible()) {
    const shown = await agentRows(page).first().getAttribute("data-agent-id");
    if (shown === agentId) return false;
    await allAgents(page).click();
  }
  await page
    .getByTestId("sidebar-agents")
    .locator(`[data-testid="sidebar-agent-row"][data-agent-id="${agentId}"]`)
    .click();
  await expect(allAgents(page)).toBeVisible();
  return true;
}

/** UNIT_BOUNDARY_DESCRIPTION: the rows of the sessions the agent view lists, the agent's own. */
export function agentSessionRows(page: Page): Locator {
  return page.getByTestId("sidebar-agent-sessions").getByTestId("session-row");
}
