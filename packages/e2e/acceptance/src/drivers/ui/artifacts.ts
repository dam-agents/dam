import { expect, test } from "@playwright/test";

import type { ArtifactsDriver } from "../driver.js";
import { openHome, type Pages } from "./pages.js";

export function uiArtifacts(pages: Pages): ArtifactsDriver {
  return {
    async expectInLibrary(person, title) {
      const page = await pages.of(person);
      await openHome(page);
      await page
        .getByTestId("app-sidebar")
        .getByRole("button", { name: "Artifacts" })
        .click();
      await expect(async () => {
        await page.reload();
        await expect(page.getByText(title, { exact: true })).toBeVisible({
          timeout: 5_000,
        });
      }).toPass({ timeout: 90_000 });
    },
    async expectPublishedBy() {
      test.skip(true, "the library page does not name an artifact's agent");
    },
  };
}
