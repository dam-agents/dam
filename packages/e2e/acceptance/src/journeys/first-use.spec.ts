// TEST_OVERVIEW: the first-use journey, one story a new owner walks in the browser from signing in to an answer from their first agent, and out again by deleting it. It depends on no other test: it signs in as the journey account of its own worker slot, which nothing else uses.
import { expect } from "@playwright/test";

import { signInThroughTheBrowser } from "../auth.js";
import { test } from "../fixtures.js";

const mockDefaultReply = "Hello from the mock agent.";

// TEST_SCENARIO: a new owner signs in, has a model provider, makes an agent in one click from the Generalist starter kit, which gets a generated avatar, chats with it until it answers, and deletes it from its settings. The provider is connected through the API: no driver covers the connect dialog yet.
test("first use: sign in, one-click agent, first answer, delete", async ({
  browser,
  person,
}, testInfo) => {
  test.setTimeout(420_000);
  const jo = await person("Jo");
  const context = await browser.newContext();
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  let agentName = "";
  try {
    await test.step("Jo signs in", async () => {
      await signInThroughTheBrowser(page, jo.account);
    });

    await test.step("Jo has a model provider connected", async () => {
      await jo.api.connections.create.mutate({
        templateId: "openai",
        name: "openai",
        authKind: "header",
        value: "sk-acceptance-dummy-key",
      });
    });

    await test.step("Jo makes an agent from the Generalist starter kit", async () => {
      const before = new Set(
        (await jo.api.agents.list.query()).map((a) => a.id),
      );
      await page
        .getByTestId("app-sidebar")
        .getByRole("button", { name: "Starter kits" })
        .click();
      await page.getByTestId("default-agent-card").click();
      await expect(page).toHaveURL(/\/chat\//);
      const made = (await jo.api.agents.list.query()).find(
        (a) => !before.has(a.id),
      );
      expect(made, "the one-click create made no agent").toBeDefined();
      expect(made!.avatar, "the one-click agent has no avatar").toBeTruthy();
      agentName = made!.name;
    });

    await test.step("Jo's agent answers Jo's first message", async () => {
      const input = page.getByPlaceholder(/^(queue a )?message(…|\.\.\.)/i);
      await expect(input).toBeVisible({ timeout: 240_000 });
      await input.fill("hello");
      await expect(
        page
          .getByTestId("chat-composer")
          .getByRole("button", { name: /^(Send|Queue)$/ }),
      ).toBeEnabled({ timeout: 240_000 });
      await input.press("Enter");
      await expect(
        page
          .locator('[data-testid="chat-message"][data-role="assistant"]')
          .filter({ hasText: mockDefaultReply }),
      ).toBeVisible({ timeout: 240_000 });
    });

    await test.step("Jo deletes the agent from its settings", async () => {
      await page.goto("/");
      await page
        .getByTestId("agent-row")
        .filter({
          has: page.getByRole("heading", { name: agentName, exact: true }),
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
            (await jo.api.agents.list.query()).some(
              (a) => a.name === agentName,
            ),
          { timeout: 120_000, intervals: [2_000] },
        )
        .toBe(false);
    });
  } finally {
    const path = testInfo.outputPath("journey-trace.zip");
    await context.tracing.stop({ path });
    await testInfo.attach("journey-trace.zip", {
      path,
      contentType: "application/zip",
    });
    await context.close();
    for (const connection of await jo.api.connections.list.query())
      if (connection.templateId === "openai")
        await jo.api.connections.delete.mutate({ id: connection.id });
  }
});
