import { expect } from "@playwright/test";

import type { World } from "../../world.js";
import type { ChatDriver } from "../driver.js";
import { agentCard, agentUp, openHome, type Pages } from "./pages.js";

export function uiChat(world: World, pages: Pages): ChatDriver {
  return {
    async send(person, name, text) {
      const agent = world.agent(name);
      const page = await pages.of(person);
      await openHome(page);
      await expect(agentCard(page, agent.name).getByText(agentUp)).toBeVisible({
        timeout: 240_000,
      });
      await page
        .getByRole("heading", { name: agent.name, exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`/chat/${agent.id}`));
      const input = page.getByPlaceholder(/^(queue a )?message(…|\.\.\.)/i);
      await input.fill(text);
      await expect(
        page
          .getByTestId("chat-composer")
          .getByRole("button", { name: /^(Send|Queue)$/ }),
      ).toBeEnabled({ timeout: 60_000 });
      await input.press("Enter");
    },
    async expectAnswer(person, _name, text) {
      const page = await pages.of(person);
      const answers = page.locator(
        '[data-testid="chat-message"][data-role="assistant"]',
      );
      await expect(
        text === undefined
          ? answers.first()
          : answers.filter({ hasText: text }),
      ).toBeVisible({ timeout: 60_000 });
    },
  };
}
