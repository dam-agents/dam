import { expect, type Locator, type Page } from "@playwright/test";

import { baseUrl } from "../../config.js";
import type { World } from "../../world.js";
import type { OrderDriver } from "../driver.js";
import {
  agentRows,
  agentSessionRows,
  showAgentView,
  showAllAgents,
} from "./nav.js";
import type { Pages } from "./pages.js";

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
 * UNIT_BOUNDARY_DESCRIPTION: the order of the agents and of an agent's sessions in the web UI's left nav: an agent moves by drag and drop where every agent is listed, and an agent's sessions show in its own view, which a click on the agent opens. A move is undone through the API when the example ends.
 */
export function uiOrder(world: World, pages: Pages): OrderDriver {
  const row = (page: Page, name: string) =>
    agentRows(page).filter({
      hasText: new RegExp(`^${world.nameOf(name)}\\s*(\\(unread\\))?$`),
    });
  const shownSessions = async (page: Page) =>
    agentSessionRows(page).evaluateAll((rows) =>
      rows.map((r) => r.querySelector("span")?.textContent ?? ""),
    );
  return {
    async expectAgents(person, names) {
      const page = await pages.of(person);
      await showAllAgents(page);
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
      await showAllAgents(page);
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
      await showAgentView(await pages.of(person), world.agent(agentName).id);
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
      await showAgentView(page, world.agent(agentName).id);
      const titles = new Set(texts.map((t) => world.unique(t)));
      await expect
        .poll(
          async () =>
            (await shownSessions(page))
              .map((t) => t.trim())
              .filter((t) => titles.has(t)),
          { timeout: 30_000 },
        )
        .toEqual(texts.map((t) => world.unique(t)));
    },
  };
}
