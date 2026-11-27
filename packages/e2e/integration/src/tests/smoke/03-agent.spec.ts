import { expect, test } from "@playwright/test";

import { baseUrl } from "../../config.js";
import { waitForAgentIdRunning } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";

test("one-click create from the Generalist card, its avatar, and delete from its settings", async ({
  page,
}) => {
  test.setTimeout(300_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  await test.step("open app", async () => {
    await page.goto(baseUrl);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
  });

  let oneClickId: string | undefined;
  await test.step("create an agent in one click from the Generalist card", async () => {
    const before = new Set((await api.agents.list.query()).map((a) => a.id));
    await page
      .getByTestId("app-sidebar")
      .getByRole("button", { name: "Starter kits" })
      .click();
    await page.getByTestId("default-agent-card").click();
    await expect(page).toHaveURL(/\/chat\//);
    oneClickId = (await api.agents.list.query()).find(
      (a) => !before.has(a.id),
    )?.id;
    expect(oneClickId).toBeTruthy();
  });

  await test.step("the one-click agent boots with a generated avatar", async () => {
    const agent = (await api.agents.list.query()).find(
      (a) => a.id === oneClickId,
    );
    expect(agent?.avatar).toBeTruthy();
    await waitForAgentIdRunning(api, agent!.id);
  });

  await test.step("delete the one-click agent from its settings, opened by the Home card's wrench", async () => {
    const agent = (await api.agents.list.query()).find(
      (a) => a.id === oneClickId,
    );
    await page.goto(baseUrl);
    await page
      .getByTestId("agent-row")
      .filter({
        has: page.getByRole("heading", { name: agent!.name, exact: true }),
      })
      .getByRole("button", { name: "Agent settings" })
      .press("Enter");
    await page
      .getByRole("button", { name: "Delete", exact: true })
      .press("Enter");
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete agent" })
      .click();
    await expect
      .poll(
        async () =>
          (await api.agents.list.query()).some((a) => a.id === agent!.id),
        { timeout: 120_000, intervals: [2_000] },
      )
      .toBe(false);
  });
});
