// TEST_OVERVIEW: The user pins Agents to the top of the sidebar, and Sessions to the top of their own Agent's list, with the pin button on hover or by drag and drop, in a real browser against a real api-server. Only the "Drop to pin" area, shown at the top of a list while nothing in it is pinned, and the pinned rows take a drop: a drop there moves the item to that place and pins it. A drop on an unpinned row cancels the drag: nothing moves and nothing is pinned. The pin button and the "⋯" button take a click anywhere on their visible area, and a pinned row never shows two pin icons. The order is kept per user, so it survives a reload. The spec creates its own Agents, so the Agents and Sessions of the other specs never move.
import { expect, type Locator, type Page, test } from "@playwright/test";

import { baseUrl } from "../../config.js";
import {
  chatInput,
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

const AGENTS = ["e2e-pins-a", "e2e-pins-b", "e2e-pins-c"] as const;
const PROMPTS = ["pins-first", "pins-second", "pins-third"] as const;
const reply = "pins-reply";

let api: ApiClient;
const agentIds = new Map<string, string>();

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

function agentRows(page: Page): Locator {
  return page.getByTestId("sidebar-agents").getByTestId("sidebar-agent-row");
}

async function shownAgents(page: Page): Promise<string[]> {
  const names = await agentRows(page).evaluateAll((rows) =>
    rows.map((row) => row.textContent?.replace("(unread)", "").trim() ?? ""),
  );
  return names.filter((name) => (AGENTS as readonly string[]).includes(name));
}

async function pinnedAgents(page: Page): Promise<string[]> {
  const names = await page
    .getByTestId("sidebar-agents")
    .locator("li > [data-pinned=true]")
    .getByTestId("sidebar-agent-row")
    .evaluateAll((rows) => rows.map((row) => row.textContent?.trim() ?? ""));
  return names.filter((name) => (AGENTS as readonly string[]).includes(name));
}

function sessionRows(page: Page): Locator {
  return sidebarAgentRow(page, AGENTS[0]).getByTestId("session-row");
}

async function shownSessions(page: Page): Promise<string[]> {
  return sessionRows(page).evaluateAll((rows) =>
    rows.map(
      (row) =>
        `${row.querySelector("span")?.textContent ?? ""}${row.querySelector("[data-testid=session-pinned]") ? "*" : ""}`,
    ),
  );
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
  const listed = await api.agents.list.query();
  for (const name of AGENTS) {
    const found = listed.find((agent) => agent.name === name);
    const id =
      found?.id ??
      (
        await api.agents.create.mutate(
          onLaneBackend({ name, templateId: harnessName }),
        )
      ).id;
    agentIds.set(name, id);
    if (name !== AGENTS[0]) await api.agents.sleep.mutate({ id });
  }
  for (const [name, id] of agentIds)
    await waitAgentState(
      api,
      id,
      name === AGENTS[0] ? "running" : "hibernated",
    );
  await api.sidebarPins.setAgents.mutate({ agentIds: [] });
});

test.afterAll(async () => {
  await api.sidebarPins.setAgents.mutate({ agentIds: [] });
  for (const id of agentIds.values()) await api.agents.delete.mutate({ id });
});

// TEST_SCENARIO: with no Agent pinned, a drag shows "Drop to pin" at the top. A drop on an unpinned row cancels the drag; a drop on the area pins the Agent first; a drop on the lower half of a pinned row pins the Agent right after it; the order is the same after a reload.
test("drag pins and orders Agents, and a drop on an unpinned row cancels", async ({
  page,
}) => {
  await openSidebar(page);
  await expect.poll(() => shownAgents(page)).toHaveLength(AGENTS.length);
  const order = await shownAgents(page);
  const row = (name: string) =>
    agentRows(page).filter({ hasText: new RegExp(`^${name}$`) });
  const zone = () =>
    page.getByTestId("sidebar-agents").getByTestId("sidebar-pin-drop-zone");

  await test.step("a drop on an unpinned row changes nothing", async () => {
    await dragTo(page, row(order[0]!), () => row(order[2]!), "bottom");
    await expect(zone()).toHaveCount(0);
    expect(await shownAgents(page)).toEqual(order);
    expect(await pinnedAgents(page)).toEqual([]);
    expect((await api.sidebarPins.get.query()).agents).toEqual([]);
  });

  await test.step("a drop on Drop to pin pins the Agent first", async () => {
    await dragTo(page, row(order[2]!), zone, "middle");
    await expect.poll(() => pinnedAgents(page)).toEqual([order[2]]);
    await expect(agentRows(page).first()).toHaveText(order[2]!);
  });

  await test.step("a drop on a pinned row pins the Agent beside it", async () => {
    await dragTo(page, row(order[1]!), () => row(order[2]!), "bottom");
    await expect.poll(() => pinnedAgents(page)).toEqual([order[2], order[1]]);
    await dragTo(page, row(order[1]!), () => row(order[2]!), "top");
    await expect.poll(() => pinnedAgents(page)).toEqual([order[1], order[2]]);
    expect(await shownAgents(page)).toEqual([order[1], order[2], order[0]]);
  });

  await test.step("the order survives a reload", async () => {
    await reload(page);
    await ensureSidebarExpanded(page);
    await expect
      .poll(() => shownAgents(page))
      .toEqual([order[1], order[2], order[0]]);
    expect(await pinnedAgents(page)).toEqual([order[1], order[2]]);
  });
});

// TEST_SCENARIO: the hover pin button takes a click on every point of the icon, appends the Agent to the end of the pinned rows, and a second click unpins it.
test("the hover pin button pins an Agent at the end of the pinned rows", async ({
  page,
}) => {
  await openSidebar(page);
  await expect.poll(() => shownAgents(page)).toHaveLength(AGENTS.length);
  const [, , last] = await shownAgents(page);
  const before = await pinnedAgents(page);
  const container = sidebarAgentRow(page, last!);
  await container.getByTestId("sidebar-agent-row").hover();
  const pin = container.getByRole("button", { name: "Pin agent" });
  await expect(pin).toBeVisible();
  await expectFullHitArea(pin);
  const box = await pin.boundingBox();
  await page.mouse.click(box!.x + box!.width - 3, box!.y + box!.height - 3);
  await expect.poll(() => pinnedAgents(page)).toEqual([...before, last]);
  await container.getByTestId("sidebar-agent-row").hover();
  await expect(container.getByLabel("Pinned")).toBeHidden();
  await container.getByRole("button", { name: "Unpin agent" }).click();
  await expect.poll(() => pinnedAgents(page)).toEqual(before);
});

// TEST_SCENARIO: Sessions pin and reorder within their own Agent's list by the same rules. A pinned row shows one pin icon on hover. The pin and "⋯" buttons of a working row take a click on every point: the hidden working indicator sits in the same place and must not catch it.
test("drag pins and orders Sessions within their Agent", async ({ page }) => {
  test.setTimeout(600_000);
  const name = AGENTS[0];
  const agentId = agentIds.get(name)!;
  await waitForAgentRunning(api, name);
  await setMockAgentReply(api, agentId, reply);
  await api.sidebarPins.setSessions.mutate({ agentId, sessionIds: [] });

  await test.step("start three Sessions", async () => {
    await openAgentChat(page, name, agentId);
    for (const [i, prompt] of PROMPTS.entries()) {
      if (i > 0) {
        await sidebarAgentRow(page, name)
          .getByRole("button", { name: "New session" })
          .click();
        await expect(chatInput(page)).toBeVisible();
      }
      await sendMessageToAgent(page, prompt);
      await expect(page.getByText(reply)).toBeVisible({ timeout: 60_000 });
    }
    await expect(sessionRows(page)).toHaveCount(PROMPTS.length, {
      timeout: 30_000,
    });
  });

  const order = (await shownSessions(page)).map((title) => title);
  const row = (title: string) =>
    sessionRows(page).filter({ hasText: title }).first();
  const zone = () =>
    sidebarAgentRow(page, name).getByTestId("sidebar-pin-drop-zone");

  await test.step("a drop on an unpinned Session changes nothing", async () => {
    await dragTo(page, row(order[0]!), () => row(order[2]!), "bottom");
    await expect(zone()).toHaveCount(0);
    expect(await shownSessions(page)).toEqual(order);
  });

  await test.step("Drop to pin, then a drop on a pinned Session", async () => {
    await dragTo(page, row(order[2]!), zone, "middle");
    await expect
      .poll(() => shownSessions(page))
      .toEqual([`${order[2]}*`, order[0], order[1]]);
    await dragTo(page, row(order[1]!), () => row(order[2]!), "top");
    await expect
      .poll(() => shownSessions(page))
      .toEqual([`${order[1]}*`, `${order[2]}*`, order[0]]);
  });

  await test.step("a pinned row shows one pin icon on hover", async () => {
    const pinnedRow = row(order[1]!);
    await pinnedRow.hover();
    await expect(pinnedRow.getByTestId("session-pinned")).toBeHidden();
    await expect(pinnedRow.getByTestId("session-pin-button")).toBeVisible();
  });

  await test.step("the buttons of a working row take every click", async () => {
    await setMockLongTurnReply(api, agentId, {
      holdMs: 30_000,
      tail: "pins-long-tail",
    });
    await sendMessageToAgent(page, "pins-working");
    const working = row(order[0]!);
    await expect(working.getByTestId("working-dots")).toBeAttached();
    await working.hover();
    await expectFullHitArea(working.getByTestId("session-pin-button"));
    await expectFullHitArea(working.getByTestId("session-menu-button"));
    const menu = await working.getByTestId("session-menu-button").boundingBox();
    await page.mouse.click(menu!.x + 3, menu!.y + menu!.height - 3);
    await expect(page.getByTestId("session-rename-button")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("pins-long-tail")).toBeVisible({
      timeout: 60_000,
    });
  });

  await test.step("the order survives a reload", async () => {
    await reload(page);
    await ensureSidebarExpanded(page);
    await expect
      .poll(() => shownSessions(page))
      .toEqual([`${order[1]}*`, `${order[2]}*`, order[0]]);
  });
});
