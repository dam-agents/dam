// TEST_OVERVIEW: The sidebar lists Agents, and the Sessions of each Agent, in one manual order per user that the user sets by drag and drop, in a real browser against a real api-server. A drop on a row puts the dragged item before or after it, by the half of the row the pointer is in. A Session moves only within its own Agent's list. A new Agent or a new Session goes to the bottom of its list, and activity never moves anything. The order survives a reload and is the same in another browser. The "⋯" button of a Session row takes a click anywhere on its visible area, also on a working row, where a hidden indicator sits in the same place. The spec creates its own Agents, so the Agents and Sessions of the other specs never move.
import { expect, type Locator, type Page, test } from "@playwright/test";

import { baseUrl } from "../../config.js";
import {
  chatInput,
  deleteAgentIfPresent,
  ensureSidebarExpanded,
  openAgentChat,
  sendMessageToAgent,
  setMockAgentReply,
  setMockLongTurnReply,
  sidebarAgentRow,
  waitForAgentRunning,
} from "../../lib/agents.js";
import {
  type ApiClient,
  createRefreshingApiClient,
} from "../../lib/api-client.js";
import { acceptTerms } from "../../lib/auth.js";
import {
  onLaneBackend,
  refreshingToken,
  waitAgentState,
} from "../../lib/backend.js";
import { harnessName } from "../../lib/fixtures.js";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 1100 } });

const AGENTS = ["e2e-order-a", "e2e-order-b", "e2e-order-c"] as const;
const LATE_AGENT = "e2e-order-d";
const PROMPTS = ["order-first", "order-second", "order-third"] as const;
const reply = "order-reply";

let api: ApiClient;
const agentIds = new Map<string, string>();
const ours = (name: string) =>
  (AGENTS as readonly string[]).includes(name) || name === LATE_AGENT;

async function reload(page: Page): Promise<void> {
  await page.reload().catch(async (error: Error) => {
    if (!error.message.includes("ERR_NETWORK_CHANGED")) throw error;
    await page.reload();
  });
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

async function openSidebar(page: Page): Promise<void> {
  await page.goto(baseUrl);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await ensureSidebarExpanded(page);
}

async function shownAgents(page: Page): Promise<string[]> {
  const names = await page
    .getByTestId("sidebar-agents")
    .getByTestId("sidebar-agent-row")
    .evaluateAll((rows) =>
      rows.map((row) => row.textContent?.replace("(unread)", "").trim() ?? ""),
    );
  return names.filter(ours);
}

function agentRow(page: Page, name: string): Locator {
  return sidebarAgentRow(page, name).getByTestId("sidebar-agent-row");
}

function sessionRows(page: Page): Locator {
  return sidebarAgentRow(page, AGENTS[0]).getByTestId("session-row");
}

async function shownSessions(page: Page): Promise<string[]> {
  return sessionRows(page).evaluateAll((rows) =>
    rows.map((row) => row.querySelector("span")?.textContent ?? ""),
  );
}

async function createSleeping(name: string): Promise<string> {
  const { id } = await api.agents.create.mutate(
    onLaneBackend({ name, templateId: harnessName }),
  );
  agentIds.set(name, id);
  await api.agents.sleep.mutate({ id });
  return id;
}

async function dragTo(
  page: Page,
  from: Locator,
  to: () => Locator,
  at: "top" | "bottom" | "middle",
): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const start = await from.boundingBox();
  expect(start).toBeTruthy();
  await page.mouse.move(start!.x + 40, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(start!.x + 45, start!.y + start!.height / 2 + 6, {
    steps: 4,
  });
  await expect(to()).toBeVisible();
  const end = await to().boundingBox();
  expect(end).toBeTruthy();
  const y =
    end!.y + end!.height * (at === "top" ? 0.2 : at === "bottom" ? 0.8 : 0.5);
  await page.mouse.move(end!.x + 40, y, { steps: 10 });
  await page.mouse.move(end!.x + 42, y, { steps: 2 });
  await page.mouse.up();
}

async function expectFullHitArea(button: Locator): Promise<void> {
  const misses = await button.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const [cx, cy] = [box.left + box.width / 2, box.top + box.height / 2];
    const points = [
      [cx, cy],
      [box.left + 1, cy],
      [box.right - 1, cy],
      [cx, box.top + 1],
      [cx, box.bottom - 1],
      [box.left + 3, box.top + 3],
      [box.right - 3, box.bottom - 3],
    ] as const;
    return points.filter(
      ([x, y]) => !el.contains(document.elementFromPoint(x, y)),
    );
  });
  expect(misses, "points of the button another element covers").toEqual([]);
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  api = createRefreshingApiClient(refreshingToken());
  await acceptTerms(api);
  for (const name of [...AGENTS, LATE_AGENT])
    await deleteAgentIfPresent(api, name);
  for (const name of AGENTS) {
    if (name !== AGENTS[0]) {
      await createSleeping(name);
      continue;
    }
    const { id } = await api.agents.create.mutate(
      onLaneBackend({ name, templateId: harnessName }),
    );
    agentIds.set(name, id);
  }
  for (const [name, id] of agentIds)
    await waitAgentState(
      api,
      id,
      name === AGENTS[0] ? "running" : "hibernated",
    );
  await api.sidebarOrder.setAgents.mutate({ agentIds: [] });
});

test.afterAll(async () => {
  await api.sidebarOrder.setAgents.mutate({ agentIds: [] });
  for (const id of agentIds.values()) await api.agents.delete.mutate({ id });
});

// TEST_SCENARIO: a drag moves an Agent to any place in the list: after the row it is dropped on in its lower half, before it in its upper half. The order is the same after a reload and in a second browser, and an Agent created after that goes to the bottom.
test("drag reorders Agents, and a new Agent goes to the bottom", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await openSidebar(page);
  await expect.poll(() => shownAgents(page)).toHaveLength(AGENTS.length);
  const start = await shownAgents(page);
  const [first, second, third] = start as [string, string, string];

  await test.step("a drop on the lower half puts the Agent after the row", async () => {
    await dragTo(
      page,
      agentRow(page, first),
      () => agentRow(page, third),
      "bottom",
    );
    await expect.poll(() => shownAgents(page)).toEqual([second, third, first]);
  });

  await test.step("a drop on the upper half puts the Agent before the row", async () => {
    await dragTo(
      page,
      agentRow(page, third),
      () => agentRow(page, second),
      "top",
    );
    await expect.poll(() => shownAgents(page)).toEqual([third, second, first]);
  });

  await test.step("the order survives a reload", async () => {
    await reload(page);
    await ensureSidebarExpanded(page);
    await expect.poll(() => shownAgents(page)).toEqual([third, second, first]);
  });

  await test.step("a second browser shows the same order", async () => {
    const other = await browser.newContext({
      storageState: "./.auth/user.json",
    });
    try {
      const second2 = await other.newPage();
      await openSidebar(second2);
      await expect
        .poll(() => shownAgents(second2))
        .toEqual([third, second, first]);
    } finally {
      await other.close();
    }
  });

  await test.step("a new Agent goes to the bottom", async () => {
    await createSleeping(LATE_AGENT);
    await expect
      .poll(() => shownAgents(page))
      .toEqual([third, second, first, LATE_AGENT]);
  });
});

// TEST_SCENARIO: Sessions keep one manual order within their own Agent. A drag moves a Session to any place there, a drop on another Agent changes nothing, a new Session goes to the bottom, and a turn in a Session moves nothing. The "⋯" button of a working row takes a click on every point: the hidden working indicator sits in the same place and must not catch it.
test("drag reorders Sessions within their Agent, and a new Session goes to the bottom", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const name = AGENTS[0];
  const agentId = agentIds.get(name)!;
  await waitForAgentRunning(api, name);
  await setMockAgentReply(api, agentId, reply);

  const newSession = async (prompt: string) => {
    await sidebarAgentRow(page, name)
      .getByRole("button", { name: "New session" })
      .click();
    await expect(chatInput(page)).toBeVisible();
    await sendMessageToAgent(page, prompt);
    await expect(page.getByText(reply)).toBeVisible({ timeout: 60_000 });
  };

  await test.step("start three Sessions", async () => {
    await openAgentChat(page, name, agentId);
    await sendMessageToAgent(page, PROMPTS[0]);
    await expect(page.getByText(reply)).toBeVisible({ timeout: 60_000 });
    for (const prompt of PROMPTS.slice(1)) await newSession(prompt);
    await expect(sessionRows(page)).toHaveCount(PROMPTS.length, {
      timeout: 30_000,
    });
  });

  const start = await shownSessions(page);
  const [first, second, third] = start as [string, string, string];
  const row = (title: string) =>
    sessionRows(page).filter({ hasText: title }).first();

  await test.step("a drag moves a Session to the place it is dropped", async () => {
    await dragTo(page, row(first), () => row(third), "bottom");
    await expect
      .poll(() => shownSessions(page))
      .toEqual([second, third, first]);
    await dragTo(page, row(third), () => row(second), "top");
    await expect
      .poll(() => shownSessions(page))
      .toEqual([third, second, first]);
  });

  await test.step("a drop on another Agent changes nothing", async () => {
    const agents = await shownAgents(page);
    await dragTo(page, row(second), () => agentRow(page, AGENTS[1]), "middle");
    await page.waitForTimeout(1_000);
    expect(await shownSessions(page)).toEqual([third, second, first]);
    expect(await shownAgents(page)).toEqual(agents);
    expect(
      (await api.sidebarOrder.get.query()).sessions[agentIds.get(AGENTS[1])!],
    ).toBeUndefined();
  });

  await test.step("a turn in a Session moves nothing, and its ⋯ button takes every click", async () => {
    await setMockLongTurnReply(api, agentId, {
      holdMs: 30_000,
      tail: "order-long-tail",
    });
    await sendMessageToAgent(page, "order-working");
    const working = sessionRows(page).and(page.locator('[data-active="true"]'));
    await expect(working.getByTestId("working-dots")).toBeAttached();
    expect(await shownSessions(page)).toEqual([third, second, first]);
    await working.hover();
    await expectFullHitArea(working.getByTestId("session-menu-button"));
    const menu = await working.getByTestId("session-menu-button").boundingBox();
    await page.mouse.click(menu!.x + 3, menu!.y + menu!.height - 3);
    await expect(page.getByTestId("session-rename-button")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("order-long-tail")).toBeVisible({
      timeout: 60_000,
    });
    expect(await shownSessions(page)).toEqual([third, second, first]);
  });

  await test.step("the order survives a reload", async () => {
    await reload(page);
    await ensureSidebarExpanded(page);
    await expect
      .poll(() => shownSessions(page))
      .toEqual([third, second, first]);
  });

  await test.step("a new Session goes to the bottom", async () => {
    await setMockAgentReply(api, agentId, reply);
    await newSession("order-fourth");
    await expect(sessionRows(page)).toHaveCount(PROMPTS.length + 1, {
      timeout: 30_000,
    });
    const shown = await shownSessions(page);
    expect(shown.slice(0, 3)).toEqual([third, second, first]);
    expect(shown[3]).not.toEqual("");
    expect(start).not.toContain(shown[3]);
  });
});
