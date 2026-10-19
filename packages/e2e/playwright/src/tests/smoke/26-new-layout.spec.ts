// TEST_OVERVIEW: The new layout experiment replaces the app shell for the user who turns it on, and turning it off restores the current one. With it on, the sidebar is a strip of Agent avatars beside a list of Sessions, Home is a dashboard of cards, the right rail draws tiles with Documentation among them, a Session can be pinned to a section above the rest, and an Agent's own column filters its Sessions as All agents does. The spec creates its own Agents and the one Session it pins, so it moves nothing the other specs read, and it leaves the experiment off.
import { expect, type Page, test } from "@playwright/test";

import { baseUrl } from "../../config.js";
import {
  chatInput,
  deleteAgentIfPresent,
  sendMessageToAgent,
  setMockAgentReply,
  waitForAgentRunning,
} from "../../lib/agents.js";
import {
  type ApiClient,
  createRefreshingApiClient,
} from "../../lib/api-client.js";
import { acceptTerms } from "../../lib/auth.js";
import { refreshingToken, waitAgentState } from "../../lib/backend.js";
import { harnessName } from "../../lib/fixtures.js";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 1000 } });

const AGENTS = ["e2e-layout-a", "e2e-layout-b"] as const;
const reply = "layout-reply";

let api: ApiClient;
const agentIds = new Map<string, string>();

async function setNewLayout(enabled: boolean): Promise<void> {
  const flags = await api.features.setFlag.mutate({
    feature: "new-layout",
    enabled,
  });
  expect(flags["new-layout"], "the new-layout experiment flag").toBe(enabled);
}

async function openHome(page: Page): Promise<void> {
  await page.goto(baseUrl);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  api = createRefreshingApiClient(refreshingToken());
  await acceptTerms(api);
  for (const name of AGENTS) await deleteAgentIfPresent(api, name);
  for (const name of AGENTS) {
    const { id } = await api.agents.create.mutate({
      name,
      templateId: harnessName,
    });
    agentIds.set(name, id);
    await api.agents.sleep.mutate({ id });
  }
  for (const id of agentIds.values())
    await waitAgentState(api, id, "hibernated");
});

test.afterAll(async () => {
  await setNewLayout(false);
  for (const id of agentIds.values()) await api.agents.delete.mutate({ id });
});

// TEST_SCENARIO: with the experiment off, the user sees the current layout: no avatar strip, and Home lists the Agents as rows.
test("keeps the current layout while the experiment is off", async ({
  page,
}) => {
  await setNewLayout(false);
  await openHome(page);
  await expect(page.getByTestId("agent-row").first()).toBeVisible();
  await expect(page.getByTestId("sidebar-avatar-strip")).toHaveCount(0);
});

// TEST_SCENARIO: with the experiment on, the sidebar is the avatar strip with the Agents in it, Home is the dashboard with no Agent rows, and the right rail has the Documentation tile between Get started and Approvals. Clicking an Agent's avatar opens its chat with its own Session list beside it.
test("shows the strip, the dashboard and the tiled rail when on", async ({
  page,
}) => {
  await setNewLayout(true);
  await openHome(page);
  const strip = page.getByTestId("sidebar-avatar-strip");
  await expect(strip).toBeVisible();
  for (const name of AGENTS)
    await expect(strip.getByRole("button", { name })).toBeVisible();
  await expect(page.getByRole("region", { name: "Overview" })).toBeVisible();
  await expect(page.getByTestId("agent-row")).toHaveCount(0);
  await expect(page.getByTestId("side-panel-docs")).toBeVisible();

  await strip.getByRole("button", { name: AGENTS[0] }).click();
  await expect(page).toHaveURL(
    new RegExp(`/chat/${encodeURIComponent(agentIds.get(AGENTS[0])!)}`),
  );
  await expect(
    page.locator(
      `[data-testid="sidebar-agent-column"][data-agent-name="${AGENTS[0]}"]`,
    ),
  ).toBeVisible();
});

// TEST_SCENARIO: a pin moves a Session out of Recent into a Pinned section above it in the Agent's own list, and the pin survives a reload; unpinning returns it.
test("pins a Session above the rest of the Agent's list", async ({ page }) => {
  test.setTimeout(240_000);
  await setNewLayout(true);
  const name = AGENTS[0];
  const agentId = agentIds.get(name)!;
  await waitForAgentRunning(api, name);
  await setMockAgentReply(api, agentId, reply);
  await page.goto(`${baseUrl}/chat/${encodeURIComponent(agentId)}`);
  await expect(chatInput(page)).toBeVisible();
  await sendMessageToAgent(page, "layout-pin-me");
  await expect(page.getByText(reply)).toBeVisible({ timeout: 60_000 });

  const column = page.locator(
    `[data-testid="sidebar-agent-column"][data-agent-name="${name}"]`,
  );
  const row = column.getByTestId("session-row").first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();
  await row.getByTestId("session-pin-button").click();
  await expect(column.getByText("Pinned", { exact: true })).toBeVisible();
  await expect(row.getByLabel("Pinned")).toBeVisible();

  await page.reload();
  await expect(column.getByText("Pinned", { exact: true })).toBeVisible();
  await row.hover();
  await row.getByTestId("session-pin-button").click();
  await expect(column.getByText("Pinned", { exact: true })).toHaveCount(0);
});

// TEST_SCENARIO: on the chat Session the pin test made, the Agent's column header carries the session filter beside New session. Leaving Chat out of its types hides the Agent's chat Session and marks the control filtered; the filter is the one All agents shows, and putting Chat back returns the Session.
test("filters the Agent's own Sessions from its column", async ({ page }) => {
  await setNewLayout(true);
  const name = AGENTS[0];
  await page.goto(`${baseUrl}/chat/${encodeURIComponent(agentIds.get(name)!)}`);
  const column = page.locator(
    `[data-testid="sidebar-agent-column"][data-agent-name="${name}"]`,
  );
  const row = column.getByTestId("session-row").first();
  await expect(row).toBeVisible({ timeout: 30_000 });

  const filter = column.getByTestId("sidebar-session-filter");
  await expect(filter).toHaveAccessibleName("Filter sessions");
  await filter.click();
  await page.getByRole("menuitemcheckbox", { name: "Chat" }).click();
  await page.keyboard.press("Escape");
  await expect(column.getByTestId("session-row")).toHaveCount(0);
  await expect(column.getByText("No sessions match the filter.")).toBeVisible();
  await expect(filter).toHaveAccessibleName("Filter sessions (filtered)");

  await page
    .getByTestId("sidebar-avatar-strip")
    .getByRole("button", { name: "Home" })
    .click();
  await expect(page.getByTestId("sidebar-session-filter")).toHaveAccessibleName(
    "Filter sessions (filtered)",
  );
  await page
    .getByTestId("sidebar-avatar-strip")
    .getByRole("button", { name })
    .click();
  await filter.click();
  await page.getByRole("menuitemcheckbox", { name: "Chat" }).click();
  await page.keyboard.press("Escape");
  await expect(row).toBeVisible();
  await expect(filter).toHaveAccessibleName("Filter sessions");
});
