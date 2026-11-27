import { expect } from "@playwright/test";

import { baseUrl } from "../../config.js";
import type { World } from "../../world.js";
import type { AssistantDriver } from "../driver.js";
import type { Pages } from "./pages.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the assistant in the web UI: its chat opens with a greeting and five ideas while it is unused, and an idea fills the composer without sending it. The switch itself is set through the API, as no web UI Example states it.
 */
export function uiAssistant(world: World, pages: Pages): AssistantDriver {
  return {
    async switchTo(person, on) {
      await person.api.features.setFlag.mutate({
        feature: "dambledore",
        enabled: on,
      });
    },
    async openChat(person) {
      const page = await pages.of(person);
      await page.goto(`${baseUrl}/chat/${world.agent("the assistant").id}`);
    },
    async expectGreeting(person, greeting, ideas) {
      const page = await pages.of(person);
      const shown = page.getByTestId("assistant-greeting");
      await expect(shown).toBeVisible({ timeout: 60_000 });
      await expect(shown).toContainText(greeting);
      for (const idea of ideas)
        await expect(
          shown.getByRole("button", { name: new RegExp(`^${idea}:`) }),
        ).toBeVisible();
    },
    async pickIdea(person, label) {
      const page = await pages.of(person);
      await page
        .getByTestId("assistant-greeting")
        .getByRole("button", { name: new RegExp(`^${label}:`) })
        .click();
    },
    async expectComposerHolds(person, text) {
      const page = await pages.of(person);
      await expect(
        page
          .getByPlaceholder(/^(queue a )?message(…|\.\.\.)/i)
          .or(page.getByTestId("chat-composer").getByRole("textbox"))
          .first(),
      ).toHaveValue(text);
      await expect(
        page.locator('[data-testid="chat-message"][data-role="user"]'),
      ).toHaveCount(0);
    },
  };
}
