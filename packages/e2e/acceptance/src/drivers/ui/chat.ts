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
      await expect(input, "the chat takes no message").toBeVisible({
        timeout: 180_000,
      });
      await input.fill(world.unique(text));
      await expect(
        page
          .getByTestId("chat-composer")
          .getByRole("button", { name: /^(Send|Queue)$/ }),
      ).toBeEnabled({ timeout: 60_000 });
      const answers = page.locator(
        '[data-testid="chat-message"][data-role="assistant"]',
      );
      const before = await answers.count();
      await input.press("Enter");
      await expect
        .poll(() => answers.count(), {
          timeout: 120_000,
          message: `${agent.name} never answered "${text}"`,
        })
        .toBeGreaterThan(before);
      await expect(page).toHaveURL(new RegExp(`/chat/${agent.id}/[^/?#]+`));
      const sessionId = decodeURIComponent(
        new URL(page.url()).pathname.split("/")[3] ?? "",
      );
      world.opened(person.persona, name, text, sessionId);
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
