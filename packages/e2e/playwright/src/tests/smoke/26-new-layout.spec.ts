// TEST_OVERVIEW: The JanUI experiment replaces the app shell for the user who turns it on, and turning it off restores the current one. With it on, the sidebar is one tree of Agents that open to their Sessions, Home is a dashboard of cards, and with the Unified right toolbar experiment on, the right rail draws tiles with Documentation among them, an Agent's chat has the side panel and its icon bar instead of the sections beside the conversation, a Session can be pinned to a Pinned section above every Agent, the tree's one session filter narrows the Pinned section and an Agent's own Sessions, and deleting a pinned Session drops its pin. The spec creates its own Agents and the one Session it pins, so it moves nothing the other specs read, and it leaves the experiment off.
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

async function setUnifiedRightToolbar(enabled: boolean): Promise<void> {
  const flags = await api.features.setFlag.mutate({
    feature: "unified-right-toolbar",
    enabled,
  });
  expect(
    flags["unified-right-toolbar"],
    "the unified-right-toolbar experiment flag",
  ).toBe(enabled);
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
  await setUnifiedRightToolbar(false);
  for (const id of agentIds.values()) await api.agents.delete.mutate({ id });
});

// TEST_SCENARIO: with the experiment off, the user sees the current layout: no sidebar tree, and Home lists the Agents as rows.
test("keeps the current layout while the experiment is off", async ({
  page,
}) => {
  await setNewLayout(false);
  await setUnifiedRightToolbar(false);
  await openHome(page);
  await expect(page.getByTestId("agent-row").first()).toBeVisible();
  await expect(page.getByTestId("sidebar-tree")).toHaveCount(0);
});

// TEST_SCENARIO: with the experiment on, the sidebar is the tree with the Agents in it and, since Agents exist, a New agent row at the foot of the list and no plus in the header, Home is the dashboard with no Agent rows, and, with the Unified right toolbar experiment on, the right rail has the Documentation tile between Get started and Approvals. Clicking an Agent's row opens its Session list, and its list always ends with a New session row whose click opens the Agent's chat, and that row, not the Agent's, is then the current page; the chat's empty page offers the Agent's ways in as sections that open from the keyboard. The second Agent stays asleep with no Sessions, so opening its list wakes it. The Home row at the top of the tree goes back to the dashboard and leaves the open Agent open, and the Group by menu, from the keyboard, swaps the Agents for one flat list of Sessions and back.
test("shows the tree, the dashboard and the tiled rail when on", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await setNewLayout(true);
  await setUnifiedRightToolbar(true);
  await openHome(page);
  const tree = page.getByTestId("sidebar-tree");
  await expect(tree).toBeVisible();
  for (const name of AGENTS) await expect(agentNode(page, name)).toBeVisible();
  await expect(tree.getByTestId("sidebar-create-agent")).toHaveCount(0);
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
  await expect(
    node.locator(
      '[data-testid="sidebar-new-session-row"][aria-current="page"]',
    ),
  ).toHaveCount(1);
  await expect(row).not.toHaveAttribute("aria-current");
  const cli = page.getByRole("button", { name: /^CLI and SSH/ });
  await expect(cli).toHaveAttribute("aria-expanded", "false");
  await cli.focus();
  await page.keyboard.press("Enter");
  await expect(cli).toHaveAttribute("aria-expanded", "true");
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect(node.getByTestId("sidebar-new-session-row")).toHaveCount(0);

  const woken = agentNode(page, AGENTS[1]);
  await woken.getByTestId("sidebar-agent-row").click();

  const home = tree.getByTestId("sidebar-home-row");
  await home.click();
  await expect(page.getByRole("region", { name: "Overview" })).toBeVisible();
  await expect(home).toHaveAttribute("aria-current", "page");
  await expect(woken.getByTestId("sidebar-agent-row")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await waitForAgentRunning(api, AGENTS[1]);
  await expect(woken.getByTestId("sidebar-new-session-row")).toBeVisible({
    timeout: 30_000,
  });
  await expect(woken.getByTestId("session-row")).toHaveCount(0);

  const groupBy = tree.getByTestId("sidebar-group-by");
  await groupBy.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitemradio", { name: "All sessions" }).focus();
  await page.keyboard.press("Enter");
  await expect(tree.getByTestId("sidebar-flat-sessions")).toBeVisible();
  await expect(agentNode(page, AGENTS[0])).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await groupBy.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitemradio", { name: "Group by agents" }).focus();
  await page.keyboard.press("Enter");
  await expect(agentNode(page, AGENTS[0])).toBeVisible();
});

// TEST_SCENARIO: with the experiment off, an Agent's chat keeps the layout from before the side panel: a top bar with the Agent's tools, the Files and Artifacts sections in a column beside the conversation, and no icon bar. Turning the experiment on in the Experimental features tab, which the spec reveals the way the About tab does, and going back to the chat by in-app navigation, with no reload, swaps that for the side panel's icon bar, and the bar's Files icon opens the Files tab in the panel; turning it off brings the sections back.
test("switches the chat between the sections and the side panel", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await setNewLayout(false);
  await setUnifiedRightToolbar(false);
  const agentId = agentIds.get(AGENTS[1])!;
  await openHome(page);
  await page.evaluate(() =>
    localStorage.setItem("platform-debug:features-menu", "true"),
  );
  await page.goto(`${baseUrl}/chat/${encodeURIComponent(agentId)}`);
  await waitForAgentRunning(api, AGENTS[1]);
  await expect(page.getByTestId("chat-sections")).toBeVisible();
  await expect(page.getByTestId("side-panel-bar")).toHaveCount(0);

  const chatPath = `/chat/${encodeURIComponent(agentId)}`;
  const navigateInApp = (path: string) =>
    page.evaluate((to) => {
      history.pushState(null, "", to);
      dispatchEvent(new PopStateEvent("popstate"));
    }, path);
  await page.evaluate(() => {
    (window as { layoutMarker?: boolean }).layoutMarker = true;
  });
  const layoutSwitch = page.getByRole("switch", { name: "JanUI" });
  const switchLayout = async (on: boolean) => {
    await navigateInApp("/settings/features");
    await layoutSwitch.click();
    await expect(layoutSwitch).toHaveAttribute("aria-checked", String(on));
    await navigateInApp(chatPath);
    await expect(chatInput(page)).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as { layoutMarker?: boolean }).layoutMarker,
      ),
      "the page did not reload",
    ).toBe(true);
  };

  await switchLayout(true);
  const bar = page.getByTestId("side-panel-bar");
  await expect(bar).toBeVisible();
  await expect(page.getByTestId("chat-sections")).toHaveCount(0);
  await bar.getByTestId("side-panel-tab-files").click();
  await expect(
    page.getByTestId("side-panel").getByRole("heading", { name: "Files" }),
  ).toBeVisible();

  await switchLayout(false);
  await expect(page.getByTestId("side-panel-bar")).toHaveCount(0);
  await expect(page.getByTestId("chat-sections")).toBeVisible();
});

// TEST_SCENARIO: a pin moves a Session out of its Agent's list into the Pinned section above every Agent, and the pin survives a reload; unpinning returns it to the Agent. The pin is one of the row's menu actions, and focus follows the Session to its new row, or lands on its Agent's row when that Agent is closed.
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
  await row.getByTestId("session-menu-button").click();
  await page.getByRole("menuitem", { name: "Pin to top" }).click();
  await expect(inPinned).toBeVisible({ timeout: 30_000 });
  await expect(inAgent).toHaveCount(0);

  await page.reload();
  await expect(inPinned).toBeVisible({ timeout: 30_000 });
  await inPinned.hover();
  await inPinned.getByTestId("session-menu-button").click();
  await page.getByRole("menuitem", { name: "Unpin session" }).click();
  await expect(pinnedSection).toHaveCount(0);
  await expect(inAgent).toBeVisible();

  await inAgent.hover();
  await inAgent.getByTestId("session-menu-button").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(inPinned.locator("[data-row-main]")).toBeFocused();

  await inPinned.hover();
  await inPinned.getByTestId("session-menu-button").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(inAgent.locator("[data-row-main]")).toBeFocused();

  await inAgent.hover();
  await inAgent.getByTestId("session-menu-button").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(inPinned.locator("[data-row-main]")).toBeFocused();

  const agentRow = node.getByTestId("sidebar-agent-row");
  await agentRow.click();
  await expect(agentRow).toHaveAttribute("aria-expanded", "false");
  await inPinned.hover();
  await inPinned.getByTestId("session-menu-button").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(pinnedSection).toHaveCount(0);
  await expect(agentRow).toBeFocused();
});

// TEST_SCENARIO: with the chat Session the pin test made pinned again, the tree's Agents header carries the one session filter. Leaving Chat out of its types hides the Session from the Pinned section and from its Agent's list, which keeps only its New session row, and marks the control filtered; putting Chat back returns it to the Pinned section. Pins live in this browser's storage, so the delete runs in the same page: deleting the Session from its Pinned row removes it from the tree and drops its pin.
test("filters, then deletes, a pinned Session", async ({ page }) => {
  test.setTimeout(120_000);
  await setNewLayout(true);
  const name = AGENTS[0];
  await page.goto(`${baseUrl}/chat/${encodeURIComponent(agentIds.get(name)!)}`);
  const node = agentNode(page, name);
  const row = node.getByTestId("session-row").first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const sessionId = await row.getAttribute("data-session-id");
  await row.hover();
  await row.getByTestId("session-menu-button").click();
  await page.getByRole("menuitem", { name: "Pin to top" }).click();
  const pinnedSection = page.getByRole("region", { name: "Pinned" });
  const inPinned = pinnedSection.locator(
    `[data-testid="session-row"][data-session-id="${sessionId}"]`,
  );
  await expect(inPinned).toBeVisible({ timeout: 30_000 });

  const filter = page
    .getByTestId("sidebar-tree")
    .getByTestId("sidebar-session-filter");
  await expect(filter).toHaveAccessibleName("Filter sessions");
  await filter.click();
  await page.getByRole("menuitemcheckbox", { name: "Chat" }).click();
  await page.keyboard.press("Escape");
  await expect(pinnedSection).toHaveCount(0);
  await expect(node.getByTestId("session-row")).toHaveCount(0);
  await expect(node.getByTestId("sidebar-new-session-row")).toBeVisible();
  await expect(filter).toHaveAccessibleName("Filter sessions (filtered)");

  await filter.click();
  await page.getByRole("menuitemcheckbox", { name: "Chat" }).click();
  await page.keyboard.press("Escape");
  await expect(inPinned).toBeVisible();
  await expect(filter).toHaveAccessibleName("Filter sessions");

  await inPinned.hover();
  await inPinned.getByTestId("session-menu-button").click();
  await page.getByTestId("session-delete-button").click();
  await page.getByRole("button", { name: "Delete session" }).click();
  await expect(pinnedSection).toHaveCount(0, { timeout: 30_000 });
  await expect(
    page.locator(`[data-testid="session-row"][data-session-id="${sessionId}"]`),
  ).toHaveCount(0);
  const pins = await page.evaluate(() =>
    localStorage.getItem("platform-pinned-sessions"),
  );
  expect(pins ?? "").not.toContain(`${agentIds.get(name)!}:${sessionId}`);
});
