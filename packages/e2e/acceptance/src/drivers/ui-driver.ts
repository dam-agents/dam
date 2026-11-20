import { expect, type Page } from "@playwright/test";

import { baseUrl } from "../config.js";
import type { Person } from "../people.js";
import type { World } from "../world.js";
import type { Driver } from "./driver.js";

const agentUp = /^(Running|Working|Idle)$/;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Driver over the web UI: each person acts in a browser page of their own, signed in once per worker, and reads only what the page shows.
 */
export class UiDriver implements Driver {
  readonly surface = "ui";

  constructor(
    private readonly world: World,
    private readonly pageOf: (person: Person) => Promise<Page>,
  ) {}

  private async openHome(person: Person): Promise<Page> {
    const page = await this.pageOf(person);
    await page.goto(baseUrl);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    return page;
  }

  private agentCard(page: Page, name: string) {
    return page
      .getByTestId("agent-row")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  }

  async sendMessage(person: Person, agentName: string, text: string) {
    const agent = this.world.agent(agentName);
    const page = await this.openHome(person);
    const card = this.agentCard(page, agent.name);
    await expect(card.getByText(agentUp)).toBeVisible({ timeout: 120_000 });
    await page.getByRole("heading", { name: agent.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/chat/${agent.id}`));
    const input = page.getByPlaceholder(/^(queue a )?message(…|\.\.\.)/i);
    await input.fill(text);
    await expect(
      page
        .getByTestId("chat-composer")
        .getByRole("button", { name: /^(Send|Queue)$/ }),
    ).toBeEnabled({ timeout: 60_000 });
    await input.press("Enter");
  }

  async expectAnswer(person: Person, _agentName: string, text: string) {
    const page = await this.pageOf(person);
    await expect(
      page
        .locator('[data-testid="chat-message"][data-role="assistant"]')
        .filter({ hasText: text }),
    ).toBeVisible({ timeout: 60_000 });
  }

  async lookAtAgents(person: Person) {
    const page = await this.openHome(person);
    const expand = page
      .getByTestId("app-sidebar")
      .getByRole("button", { name: "Expand navigation" });
    if (await expand.isVisible()) await expand.click();
    await expect(page.getByTestId("sidebar-agents")).toBeVisible();
  }

  async expectAgentListed(person: Person, agentName: string, listed: boolean) {
    const page = await this.pageOf(person);
    const name = this.world.agents.get(agentName)?.name ?? agentName;
    const row = page
      .getByTestId("sidebar-agents")
      .getByTestId("sidebar-agent-row")
      .filter({ hasText: new RegExp(`^${name}\\s*(\\(unread\\))?$`) });
    if (listed) await expect(row).toBeVisible();
    else await expect(row).toHaveCount(0);
  }
}
