// TEST_OVERVIEW: The assistant is on for everyone by default, and landing in its
// TEST_OVERVIEW: chat is the first open: an account whose only Agent is the
// TEST_OVERVIEW: assistant meets it in a chat that greets it and offers five
// TEST_OVERVIEW: labelled ideas, while an account that already owns an Agent keeps
// TEST_OVERVIEW: the landing it had and meets the assistant in the list instead.
// TEST_OVERVIEW: The spec signs in as two accounts of its own, which store no
// TEST_OVERVIEW: switch, since the suite's shared account declines the assistant.
import { expect, type Page, test } from "@playwright/test";

import { assistantFirstUser, assistantOwnerUser } from "../../config.js";
import {
  deleteAgentIfPresent,
  ensureSidebarExpanded,
  sidebarAgentRow,
} from "../../lib/agents.js";
import { type ApiClient, createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken, loginViaUi } from "../../lib/auth.js";
import { harnessName } from "../../lib/fixtures.js";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 1100 } });

/* UNIT_BOUNDARY_DESCRIPTION: the install's assistant name, which no spec sets: the chart's brand default. */
const ASSISTANT = "Dammy";
const IDEAS = ["Artifact", "Schedule", "Knowledge base", "Skill", "DAM"];
const OWN_AGENT = "e2e-assistant-owner-agent";

async function signIn(user: {
  username: string;
  password: string;
}): Promise<ApiClient> {
  const api = createApiClient(await getAccessToken(user));
  await acceptTerms(api);
  return api;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an account with no provider Connection meets the
 * prompt its agent's first message would need one for, and closes it — what a
 * person who wants to read the greeting does. The prompt is the only thing that
 * covers the chat; the greeting is still there underneath.
 */
async function dismissProviderPrompt(page: Page): Promise<void> {
  const prompt = page.getByRole("dialog", { name: /Connect an LLM provider/ });
  await prompt
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => undefined);
  if (await prompt.isVisible()) {
    await prompt.getByRole("button", { name: "Close" }).first().click();
    await expect(prompt).toBeHidden();
  }
}

test("a first-time user lands in the assistant's chat", async ({ page }) => {
  await signIn(assistantFirstUser);
  await loginViaUi(page, assistantFirstUser);

  await dismissProviderPrompt(page);

  await test.step("the landing opens the assistant's chat", async () => {
    await expect(page).toHaveURL(/\/chat\//, { timeout: 60_000 });
    await expect(page.getByTestId("assistant-greeting")).toBeVisible({
      timeout: 60_000,
    });
  });

  await test.step("it greets the person by name, in the install's brand", async () => {
    const greeting = page.getByTestId("assistant-greeting");
    await expect(greeting).toContainText("Hi First!");
    await expect(greeting).toContainText("your personal");
  });

  await test.step("and offers the five labelled ideas", async () => {
    const greeting = page.getByTestId("assistant-greeting");
    for (const idea of IDEAS) {
      await expect(
        greeting.getByRole("button", { name: new RegExp(`^${idea}:`) }),
      ).toBeVisible();
    }
    await expect(page.getByPlaceholder(`Message ${ASSISTANT}`)).toBeVisible();
  });
});

test("an existing owner keeps their landing", async ({ page }) => {
  const api = await signIn(assistantOwnerUser);

  await test.step("own an Agent before the first landing", async () => {
    await deleteAgentIfPresent(api, OWN_AGENT);
    await api.agents.create.mutate({
      name: OWN_AGENT,
      templateId: harnessName,
    });
  });

  await loginViaUi(page, assistantOwnerUser);

  await test.step("the landing is the one the account already had", async () => {
    await expect(page).not.toHaveURL(/\/chat\//);
    await expect(page.getByTestId("assistant-greeting")).toHaveCount(0);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  });

  await test.step("and the assistant is in the list, not in the way", async () => {
    await ensureSidebarExpanded(page);
    await expect
      .poll(async () => sidebarAgentRow(page, ASSISTANT).count(), {
        timeout: 120_000,
        intervals: [2_000],
      })
      .toBeGreaterThan(0);
  });
});
