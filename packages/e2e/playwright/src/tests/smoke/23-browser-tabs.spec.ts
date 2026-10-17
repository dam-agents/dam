// TEST_OVERVIEW: the browser panel shows every tab of the agent's one browser and keeps the user and the agent on the same tab; as in Safari, its tab bar shows only while the browser has two tabs or more, and the new-tab button sits in the top bar, which always shows. The spec boots its own container agent on the default Template, whose browser and agent-browser come from the harness tools the default image bakes — the mock agents of the rest of the suite carry neither — so only the vm lane, which enables the Template, runs it. It opens the agent's panel and drives the browser from both sides: agent-browser in the agent's pod, as the agent's own commands do, and the panel's tab bar, as the user does. After each step the tab the panel marks active — the one on the user's screen — is the tab agent-browser reports as its own, compared by CDP target id, never by position.
import { expect, type Locator, type Page, test } from "@playwright/test";

import { baseUrl } from "../../config.js";
import { deleteAgentIfPresent } from "../../lib/agents.js";
import { type ApiClient, createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { createAgentOn, waitAgentState } from "../../lib/backend.js";
import { AGENT_NS, kubectl } from "../../lib/cluster.js";

test.describe.configure({ mode: "serial" });

const AGENT = "e2e-browser-tabs";
const SYNC_MS = 20_000;

let api: ApiClient;
let agentId = "";

interface AgentTab {
  targetId: string;
  active: boolean;
}

function agentBrowser(...args: string[]): string {
  return kubectl(
    "-n",
    AGENT_NS,
    "exec",
    `${agentId}-0`,
    "-c",
    "agent",
    "--",
    "agent-browser",
    ...args,
  );
}

function agentTabs(): AgentTab[] {
  const listed = JSON.parse(agentBrowser("tab", "list", "--json")) as {
    data: { tabs: AgentTab[] };
  };
  return listed.data.tabs;
}

const agentSelected = () => agentTabs().find((t) => t.active)?.targetId;

function agentOpens(title: string): string {
  agentBrowser("tab", "new", "about:blank");
  agentBrowser("eval", `document.title = ${JSON.stringify(title)}`);
  const opened = agentTabs().find((t) => t.active);
  expect(opened, `agent-browser's tab for ${title}`).toBeDefined();
  return opened!.targetId;
}

const tabBar = (page: Page) => page.getByTestId("browser-tabs");
const panelTab = (page: Page, targetId: string): Locator =>
  tabBar(page).locator(`[data-tab-id="${targetId}"]`);
const newTabButton = (page: Page) =>
  page.getByRole("button", { name: "New tab", exact: true });
const panelActive = (page: Page) =>
  tabBar(page).locator("[data-active]").getAttribute("data-tab-id");

async function expectSameTab(page: Page, targetId: string) {
  await expect(panelTab(page, targetId).getByRole("tab")).toHaveAttribute(
    "aria-selected",
    "true",
    { timeout: SYNC_MS },
  );
  await expect
    .poll(agentSelected, {
      timeout: SYNC_MS,
      message: "agent-browser's selected tab is the one on the user's screen",
    })
    .toBe(targetId);
}

async function openPanel(page: Page) {
  await page.goto(`${baseUrl}/chat/${encodeURIComponent(agentId)}`);
  await page.getByTestId("side-panel-tab-browser").click();
  await expect(page.getByLabel("Address in the agent's browser")).toBeVisible();
  await expect(page.getByText(/Starting the agent's browser/)).toHaveCount(0, {
    timeout: 120_000,
  });
}

async function expectNoTabBar(page: Page) {
  await expect(tabBar(page)).toHaveCount(0, { timeout: SYNC_MS });
  await expect(newTabButton(page)).toBeVisible();
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  api = createApiClient(await getAccessToken());
  await acceptTerms(api);
  await deleteAgentIfPresent(api, AGENT);
  agentId = await createAgentOn(api, "container", AGENT, "default");
  await waitAgentState(api, agentId, "running");
});

test.afterAll(async () => {
  if (agentId) await api.agents.delete.mutate({ id: agentId });
});

// TEST_SCENARIO: one open panel, driven from both sides. A fresh browser has one tab, for agent-browser too — Chromium's own start-up page is not a second one — and the panel shows no tab bar for it. Tabs the agent opens and names appear without a reload, the last one active — the same target agent-browser reports as selected. The user selecting a tab brings it on screen, and agent-browser selects the same target, so the agent's next command reads the page the user sees; the agent selecting another tab brings it on the user's screen in turn. Closing the active tab from the panel closes it in the browser and brings the tab before it, the last one closed, to the front for both; a new tab from the panel is blank, and the agent is on it too. With the agent's tabs closed down to one, the tab bar hides again, and the user opens a second tab from the top bar, which brings the bar back.
test("keeps the user and the agent on the same tab", async ({ page }) => {
  test.setTimeout(300_000);
  await openPanel(page);
  let alpha = "";
  let beta = "";

  await test.step("a fresh browser has one tab and no tab bar", async () => {
    expect(agentTabs()).toHaveLength(1);
    await expectNoTabBar(page);
  });

  await test.step("the agent opens two tabs", async () => {
    alpha = agentOpens("Alpha");
    await expect(tabBar(page)).toBeVisible({ timeout: SYNC_MS });
    await expect(tabBar(page).getByRole("tab")).toHaveCount(2);
    beta = agentOpens("Beta");
    await expect(panelTab(page, alpha)).toContainText("Alpha", {
      timeout: SYNC_MS,
    });
    await expect(panelTab(page, beta)).toContainText("Beta", {
      timeout: SYNC_MS,
    });
    await expectSameTab(page, beta);
  });

  await test.step("the user selects a tab, then the agent another", async () => {
    await panelTab(page, alpha).getByRole("tab").click();
    await expectSameTab(page, alpha);
    expect(agentBrowser("eval", "document.title")).toContain("Alpha");
    agentBrowser("tab", beta);
    await expectSameTab(page, beta);
  });

  await test.step("the user closes the active tab", async () => {
    await panelTab(page, beta)
      .getByRole("button", { name: "Close tab Beta" })
      .click();
    await expect(panelTab(page, beta)).toHaveCount(0, { timeout: SYNC_MS });
    await expect
      .poll(() => agentTabs().some((t) => t.targetId === beta), {
        timeout: SYNC_MS,
      })
      .toBe(false);
    await expectSameTab(page, alpha);
  });

  await test.step("the user opens a new tab", async () => {
    const before = new Set(agentTabs().map((t) => t.targetId));
    await newTabButton(page).click();
    await expect
      .poll(async () => panelActive(page), { timeout: SYNC_MS })
      .not.toBe(alpha);
    const opened = (await panelActive(page))!;
    expect(before.has(opened)).toBe(false);
    await expect(panelTab(page, opened)).toContainText("New tab");
    await expectSameTab(page, opened);
  });

  await test.step("the agent closes its tabs down to one", async () => {
    const tabs = agentTabs();
    const kept = tabs.find((t) => t.active)!.targetId;
    for (const tab of tabs)
      if (tab.targetId !== kept) agentBrowser("tab", "close", tab.targetId);
    expect(agentTabs().map((t) => t.targetId)).toEqual([kept]);
    await expectNoTabBar(page);
  });

  await test.step("the user opens a second tab from the top bar", async () => {
    const [kept] = agentTabs().map((t) => t.targetId);
    await newTabButton(page).click();
    await expect(tabBar(page).getByRole("tab")).toHaveCount(2, {
      timeout: SYNC_MS,
    });
    await expect
      .poll(async () => panelActive(page), { timeout: SYNC_MS })
      .not.toBe(kept);
    const opened = (await panelActive(page))!;
    await expect(panelTab(page, opened)).toContainText("New tab");
    await expectSameTab(page, opened);
  });
});

// TEST_SCENARIO: a panel opened again is sent the browser's tabs and active tab as they are now, not the list it last showed: a tab the agent opened while no panel watched is there, and active, and so is every other tab agent-browser knows.
test("reconciles a reopened panel with the browser", async ({ page }) => {
  test.setTimeout(300_000);
  const gamma = agentOpens("Gamma");
  await openPanel(page);
  await expect(panelTab(page, gamma)).toContainText("Gamma", {
    timeout: SYNC_MS,
  });
  await expectSameTab(page, gamma);
  for (const tab of agentTabs())
    await expect(panelTab(page, tab.targetId)).toHaveCount(1);
});
