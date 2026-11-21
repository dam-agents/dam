import { expect } from "@playwright/test";

import type { World } from "../../world.js";
import type { LiveDriver } from "../driver.js";
import { openHome, type Pages } from "./pages.js";

const liveWithinMs = 10_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: an owner's open web UI following changes made elsewhere: the page is opened once and never reloaded, so what it shows later came to it live.
 */
export function uiLive(world: World, pages: Pages): LiveDriver {
  return {
    async watchAgents(person) {
      const page = await pages.of(person);
      await openHome(page);
      const expand = page
        .getByTestId("app-sidebar")
        .getByRole("button", { name: "Expand navigation" });
      if (await expand.isVisible()) await expand.click();
      await expect(page.getByTestId("sidebar-agents")).toBeVisible();
    },
    async expectAgentChanged(person, agentName, listed) {
      const page = await pages.of(person);
      const row = page
        .getByTestId("sidebar-agents")
        .getByTestId("sidebar-agent-row")
        .filter({
          hasText: new RegExp(
            `^${world.nameOf(agentName)}\\s*(\\(unread\\))?$`,
          ),
        });
      if (listed) await expect(row).toBeVisible({ timeout: liveWithinMs });
      else await expect(row).toHaveCount(0, { timeout: liveWithinMs });
    },
  };
}
