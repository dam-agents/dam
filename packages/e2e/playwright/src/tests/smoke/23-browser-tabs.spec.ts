// TEST_OVERVIEW: the browser panel shows every tab of the agent's one browser and keeps the user and the agent on the same tab. The spec boots its own container agent, opens its panel, and drives the browser from both sides: agent-browser in the agent's pod, as the agent's own commands do, and the panel's tab bar, as the user does. After each step the tab the panel marks active — the one on the user's screen — is the tab agent-browser reports as its own, compared by CDP target id, never by position.
import { expect, type Locator, type Page, test } from "@playwright/test";

import { baseUrl } from "../../config.js";
import { deleteAgentIfPresent } from "../../lib/agents.js";
import { type ApiClient, createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import {
  createAgentOn,
  laneBackend,
  waitAgentState,
} from "../../lib/backend.js";
import { AGENT_NS, kubectl } from "../../lib/cluster.js";
import { harnessName } from "../../lib/fixtures.js";

test.describe.configure({ mode: "serial" });

const AGENT = "e2e-browser-tabs";
const SYNC_MS = 20_000;

let api: ApiClient;
let agentId = "";

interface AgentTab {
  targetId: string;
  active: boolean;
  title: string;
  url: string;
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
  await page.getByRole("button", { name: "Open browser" }).click();
  await expect(tabBar(page)).toBeVisible({ timeout: 120_000 });
}

test.beforeAll(async () => {
  test.setTimeout(600_000);
  test.skip(
    laneBackend === "vm",
    "the spec runs agent-browser through kubectl exec, which reaches a container agent's pod only",
  );
  api = createApiClient(await getAccessToken());
  await acceptTerms(api);
  await deleteAgentIfPresent(api, AGENT);
  agentId = await createAgentOn(api, "container", AGENT, harnessName);
  await waitAgentState(api, agentId, "running");
});

test.afterAll(async () => {
  if (agentId) await api.agents.delete.mutate({ id: agentId });
});

// TEST_SCENARIO: tabs the agent opens and names appear in the open panel, without a reload, and the tab the agent opened last is the one the panel marks active — the same target agent-browser reports as selected.
test("shows the agent's tabs as the agent opens them", async ({ page }) => {
  test.setTimeout(300_000);
  await openPanel(page);
  const alpha = agentOpens("Alpha");
  const beta = agentOpens("Beta");
  await expect(panelTab(page, alpha)).toContainText("Alpha", {
    timeout: SYNC_MS,
  });
  await expect(panelTab(page, beta)).toContainText("Beta", {
    timeout: SYNC_MS,
  });
  await expectSameTab(page, beta);
});

// TEST_SCENARIO: the user selects a tab in the panel: it is on the user's screen at once, and agent-browser selects the same target, so the agent's next command acts on the page the user sees; the agent selecting another tab brings it to the user's screen in turn.
test("keeps the user and the agent on the same tab both ways", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openPanel(page);
  const tabs = agentTabs();
  const alpha = tabs.find((t) => t.title === "Alpha")!.targetId;
  const beta = tabs.find((t) => t.title === "Beta")!.targetId;

  await panelTab(page, alpha).getByRole("tab").click();
  await expectSameTab(page, alpha);
  expect(agentBrowser("eval", "document.title")).toContain("Alpha");

  agentBrowser("tab", beta);
  await expectSameTab(page, beta);
});

// TEST_SCENARIO: closing the active tab from the panel closes it in the browser and brings another tab to the front, for the user and the agent alike; a new tab from the panel is blank, and the agent is on it too.
test("closes and opens tabs from the panel", async ({ page }) => {
  test.setTimeout(300_000);
  await openPanel(page);
  const beta = agentTabs().find((t) => t.title === "Beta")!.targetId;
  await expectSameTab(page, beta);

  await panelTab(page, beta)
    .getByRole("button", { name: "Close tab Beta" })
    .click();
  await expect(panelTab(page, beta)).toHaveCount(0, { timeout: SYNC_MS });
  await expect
    .poll(() => agentTabs().some((t) => t.targetId === beta), {
      timeout: SYNC_MS,
    })
    .toBe(false);
  const next = await panelActive(page);
  expect(next).not.toBeNull();
  await expectSameTab(page, next!);

  const before = new Set(agentTabs().map((t) => t.targetId));
  await tabBar(page).getByRole("button", { name: "New tab" }).click();
  await expect
    .poll(async () => panelActive(page), { timeout: SYNC_MS })
    .not.toBe(next);
  const opened = (await panelActive(page))!;
  expect(before.has(opened)).toBe(false);
  await expect(panelTab(page, opened)).toContainText("New tab");
  await expectSameTab(page, opened);
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
