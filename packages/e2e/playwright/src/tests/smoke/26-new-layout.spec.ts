// TEST_OVERVIEW: The new layout experiment replaces the app shell for the user who turns it on, and turning it off restores the current one. With it on, the sidebar is one tree of Agents that open to their Sessions, Home is a dashboard of cards, the right rail draws tiles with Documentation among them, a Session can be pinned to a Pinned section above every Agent, and the tree's one session filter narrows an Agent's own Sessions. The spec creates its own Agents and the one Session it pins, so it moves nothing the other specs read, and it leaves the experiment off.
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

function agentNode(page: Page, name: string) {
  return page.locator(
    `[data-testid="sidebar-agent"][data-agent-name="${name}"]`,
  );
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

// TEST_SCENARIO: with the experiment off, the user sees the current layout: no sidebar tree, and Home lists the Agents as rows.
test("keeps the current layout while the experiment is off", async ({
  page,
}) => {
  await setNewLayout(false);
  await openHome(page);
  await expect(page.getByTestId("agent-row").first()).toBeVisible();
  await expect(page.getByTestId("sidebar-tree")).toHaveCount(0);
});

// TEST_SCENARIO: with the experiment on, the sidebar is the tree with the Agents in it and a New agent row after them, Home is the dashboard with no Agent rows, and the right rail has the Documentation tile between Get started and Approvals. Clicking an Agent's row opens its Session list with a New session row at its end, and that row opens the Agent's chat.
test("shows the tree, the dashboard and the tiled rail when on", async ({
  page,
}) => {
  await setNewLayout(true);
  await openHome(page);
  const tree = page.getByTestId("sidebar-tree");
  await expect(tree).toBeVisible();
  for (const name of AGENTS) await expect(agentNode(page, name)).toBeVisible();
  await expect(tree.getByTestId("sidebar-new-agent-row")).toBeVisible();
  await expect(page.getByRole("region", { name: "Overview" })).toBeVisible();
  await expect(page.getByTestId("agent-row")).toHaveCount(0);
  await expect(page.getByTestId("side-panel-docs")).toBeVisible();

  const node = agentNode(page, AGENTS[0]);
  const row = node.getByTestId("sidebar-agent-row");
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await node.getByTestId("sidebar-new-session-row").click();
  await expect(page).toHaveURL(
    new RegExp(`/chat/${encodeURIComponent(agentIds.get(AGENTS[0])!)}`),
  );
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect(node.getByTestId("sidebar-new-session-row")).toHaveCount(0);
});

// TEST_SCENARIO: a pin moves a Session out of its Agent's list into the Pinned section above every Agent, and the pin survives a reload; unpinning returns it to the Agent.
test("pins a Session above every Agent", async ({ page }) => {
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

  const node = agentNode(page, name);
  const pinnedSection = page.getByRole("region", { name: "Pinned" });
  const row = node.getByTestId("session-row").first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const sessionId = await row.getAttribute("data-session-id");
  const inPinned = pinnedSection.locator(
    `[data-testid="session-row"][data-session-id="${sessionId}"]`,
  );
  const inAgent = node.locator(
    `[data-testid="session-row"][data-session-id="${sessionId}"]`,
  );
  await row.hover();
  await row.getByTestId("session-pin-button").click();
  await expect(inPinned).toBeVisible({ timeout: 30_000 });
  await expect(inAgent).toHaveCount(0);

  await page.reload();
  await expect(inPinned).toBeVisible({ timeout: 30_000 });
  await inPinned.hover();
  await inPinned.getByTestId("session-pin-button").click();
  await expect(pinnedSection).toHaveCount(0);
  await expect(inAgent).toBeVisible();
});

// TEST_SCENARIO: on the chat Session the pin test made, the tree's Agents header carries the one session filter. Leaving Chat out of its types hides the Agent's chat Session and marks the control filtered; putting Chat back returns the Session.
test("filters the Agent's own Sessions from the tree", async ({ page }) => {
  await setNewLayout(true);
  const name = AGENTS[0];
  await page.goto(`${baseUrl}/chat/${encodeURIComponent(agentIds.get(name)!)}`);
  const node = agentNode(page, name);
  const row = node.getByTestId("session-row").first();
  await expect(row).toBeVisible({ timeout: 30_000 });

  const filter = page
    .getByTestId("sidebar-tree")
    .getByTestId("sidebar-session-filter");
  await expect(filter).toHaveAccessibleName("Filter sessions");
  await filter.click();
  await page.getByRole("menuitemcheckbox", { name: "Chat" }).click();
  await page.keyboard.press("Escape");
  await expect(node.getByTestId("session-row")).toHaveCount(0);
  await expect(node.getByText("No sessions match the filter.")).toBeVisible();
  await expect(filter).toHaveAccessibleName("Filter sessions (filtered)");

  await filter.click();
  await page.getByRole("menuitemcheckbox", { name: "Chat" }).click();
  await page.keyboard.press("Escape");
  await expect(row).toBeVisible();
  await expect(filter).toHaveAccessibleName("Filter sessions");
});
