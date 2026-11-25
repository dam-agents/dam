import { expect, test } from "@playwright/test";

import type { World } from "../../world.js";
import type { ConnectionsDriver } from "../driver.js";
import { openHome, type Pages } from "./pages.js";

export function uiConnections(world: World, pages: Pages): ConnectionsDriver {
  return {
    async lookAt(person) {
      const page = await pages.of(person);
      await openHome(page);
      await page
        .getByTestId("app-sidebar")
        .getByRole("button", { name: "Settings", exact: true })
        .click();
      await page.getByRole("tab", { name: "Connections", exact: true }).click();
    },
    async expectListed(person, name, listed) {
      const page = await pages.of(person);
      const shown = page.getByText(world.connections.get(name)?.name ?? name, {
        exact: true,
      });
      if (listed) await expect(shown.first()).toBeVisible();
      else await expect(shown).toHaveCount(0);
    },
    async grant() {
      test.skip(true, "no UI driver for an agent's connections yet");
    },
    async expectGrantRefused() {
      test.skip(true, "no UI driver for an agent's connections yet");
    },
  };
}
