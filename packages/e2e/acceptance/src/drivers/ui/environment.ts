import { expect, type Page } from "@playwright/test";

import { baseUrl } from "../../config.js";
import type { World } from "../../world.js";
import type { EnvironmentDriver } from "../driver.js";
import type { Pages } from "./pages.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: an agent's environment in the web UI: the Environment section of its settings, where a person creates, edits, reveals and removes a variable. A variable an example sets is taken off the agent when it ends, through the API.
 */
export function uiEnvironment(world: World, pages: Pages): EnvironmentDriver {
  const open = async (page: Page, agentName: string) => {
    const agent = world.agent(agentName);
    await page.goto(`${baseUrl}/sandboxes/${agent.id}/environment`);
    await expect(
      page.getByRole("dialog", { name: `${agent.name} settings` }),
    ).toBeVisible();
  };
  return {
    async set(person, agentName, name, value) {
      const page = await pages.of(person);
      await open(page, agentName);
      const edit = page.getByRole("button", { name: `Edit ${name}` });
      if (await edit.isVisible()) await edit.click();
      else
        await page
          .getByRole("button", { name: "Create variable" })
          .first()
          .click();
      const form = page.getByRole("dialog", {
        name: /^(New|Edit) variable$/,
      });
      await form.getByLabel("Name").fill(name);
      await form.getByLabel("Value").fill(world.unique(value));
      await form
        .getByRole("button", { name: /^(Create variable|Save)$/ })
        .click();
      await expect(form).toBeHidden();
      const { id } = world.agent(agentName);
      world.undo.push(async () =>
        person.api.agents.setEnv.mutate({
          id,
          env: ((await person.api.agents.get.query({ id })).env ?? []).filter(
            (v) => v.name !== name,
          ),
        }),
      );
    },
    async remove(person, agentName, name) {
      const page = await pages.of(person);
      await open(page, agentName);
      await page.getByRole("button", { name: `Remove ${name}` }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Remove variable" })
        .click();
    },
    async expectShown(person, agentName, name, value) {
      const page = await pages.of(person);
      await open(page, agentName);
      await page.getByRole("button", { name: `Show value of ${name}` }).click();
      await expect(
        page.getByText(world.unique(value), { exact: true }),
      ).toBeVisible();
    },
  };
}
