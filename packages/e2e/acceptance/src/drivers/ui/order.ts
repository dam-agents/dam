import { expect, type Locator, type Page } from "@playwright/test";

import { baseUrl } from "../../config.js";
import type { World } from "../../world.js";
import type { OrderDriver } from "../driver.js";
import { openHome, type Pages } from "./pages.js";

async function showAgents(page: Page): Promise<void> {
  if (!new URL(page.url()).pathname.startsWith("/chat/")) await openHome(page);
  const expand = page
    .getByTestId("app-sidebar")
    .getByRole("button", { name: "Expand navigation" });
  if (await expand.isVisible()) await expand.click();
  await expect(page.getByTestId("sidebar-agents")).toBeVisible();
  const folded = page
    .getByTestId("sidebar-agents-hibernating")
    .filter({ hasText: "See all" });
  if (await folded.isVisible()) await folded.click();
}

function agentRows(page: Page): Locator {
  return page.getByTestId("sidebar-agents").getByTestId("sidebar-agent-row");
}

async function dragTo(
  page: Page,
  from: Locator,
  to: Locator,
  at: "top" | "bottom",
) {
  await from.scrollIntoViewIfNeeded();
  const start = await from.boundingBox();
  expect(start).toBeTruthy();
  await page.mouse.move(start!.x + 40, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(start!.x + 45, start!.y + start!.height / 2 + 6, {
    steps: 4,
  });
  const end = await to.boundingBox();
  expect(end).toBeTruthy();
  const y = end!.y + end!.height * (at === "top" ? 0.2 : 0.8);
  await page.mouse.move(end!.x + 40, y, { steps: 10 });
  await page.mouse.move(end!.x + 42, y, { steps: 2 });
  await page.mouse.up();
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the order of the agents and of an agent's sessions in the web UI's sidebar: an agent moves by drag and drop, as the old smoke spec dragged it, and an agent's sessions show under its row while it is open. A move is undone through the API when the example ends.
 */
export function uiOrder(world: World, pages: Pages): OrderDriver {
  const row = (page: Page, name: string) =>
    agentRows(page).filter({
      hasText: new RegExp(`^${world.nameOf(name)}\\s*(\\(unread\\))?$`),
    });
  const shownSessions = async (page: Page, agentName: string) =>
    page
      .getByTestId("sidebar-agents")
      .locator("li")
      .filter({
        has: page.getByTestId("sidebar-agent-row").filter({
          hasText: new RegExp(
            `^${world.nameOf(agentName)}\\s*(\\(unread\\))?$`,
          ),
        }),
      })
      .getByTestId("session-row")
      .evaluateAll((rows) =>
        rows.map((r) => r.querySelector("span")?.textContent ?? ""),
      );
  return {
    async expectAgents(person, names) {
      const page = await pages.of(person);
      await showAgents(page);
      const wanted = new Set(names.map((n) => world.nameOf(n)));
      await expect
        .poll(async () =>
          (await agentRows(page).allInnerTexts())
            .map((t) => t.replace(/\s*\(unread\)\s*$/, "").trim())
            .filter((t) => wanted.has(t)),
        )
        .toEqual(names.map((n) => world.nameOf(n)));
    },
    async move(person, name, where, target) {
      const page = await pages.of(person);
      await showAgents(page);
      await dragTo(
        page,
        row(page, name),
        row(page, target),
        where === "before" ? "top" : "bottom",
      );
      world.undo.push(() =>
        person.api.sidebarOrder.setAgents.mutate({ agentIds: [] }),
      );
    },
    async openSessions(person, agentName) {
      const page = await pages.of(person);
      await showAgents(page);
      const agent = row(page, agentName);
      if ((await agent.getAttribute("aria-expanded")) !== "true")
        await agent.click();
    },
    async sendIn(person, agentName, session, text) {
      const page = await pages.of(person);
      const { id } = world.agent(agentName);
      await page.goto(
        `${baseUrl}/chat/${id}/${encodeURIComponent(world.session(session).id)}`,
      );
      const input = page.getByPlaceholder(/^(queue a )?message(…|\.\.\.)/i);
      await expect(input).toBeVisible({ timeout: 180_000 });
      const answers = page.locator(
        '[data-testid="chat-message"][data-role="assistant"]',
      );
      const before = await answers.count();
      await input.fill(world.unique(text));
      await input.press("Enter");
      await expect
        .poll(() => answers.count(), { timeout: 120_000 })
        .toBeGreaterThan(before);
    },
    async expectSessions(person, agentName, texts) {
      const page = await pages.of(person);
      await showAgents(page);
      const titles = new Set(texts.map((t) => world.unique(t)));
      await expect
        .poll(
          async () =>
            (await shownSessions(page, agentName))
              .map((t) => t.trim())
              .filter((t) => titles.has(t)),
          { timeout: 30_000 },
        )
        .toEqual(texts.map((t) => world.unique(t)));
    },
  };
}
