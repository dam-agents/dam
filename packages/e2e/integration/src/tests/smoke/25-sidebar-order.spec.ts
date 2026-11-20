// TEST_OVERVIEW: The "⋯" button of a working Session row takes a click anywhere on its visible area, where a hidden indicator sits in the same place, in a real browser against a real api-server; on the way, the Sessions of an Agent are listed by last activity, newest first, a turn puts its Session at the top, and a Session row does not drag. The order of the Agents and of an Agent's Sessions are Examples of the acceptance suite (features/agents/agent-order.feature, features/sessions/session-order.feature); this spec keeps the hit area, a layout regression only a real page shows. It creates its own Agent, so the Agents and Sessions of the other specs never move.
import { expect, type Locator, type Page, test } from "@playwright/test";

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
import { refreshingToken, waitAgentState } from "../../lib/backend.js";
import { harnessName } from "../../lib/fixtures.js";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 1100 } });

const AGENT = "e2e-order-a";
const PROMPTS = ["order-first", "order-second", "order-third"] as const;
const reply = "order-reply";

let api: ApiClient;
const agentIds = new Map<string, string>();

async function reload(page: Page): Promise<void> {
  await page.reload().catch(async (error: Error) => {
    if (!error.message.includes("ERR_NETWORK_CHANGED")) throw error;
    await page.reload();
  });
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

function sessionRows(page: Page): Locator {
  return sidebarAgentRow(page, AGENT).getByTestId("session-row");
}

async function shownSessions(page: Page): Promise<string[]> {
  return sessionRows(page).evaluateAll((rows) =>
    rows.map((row) => row.querySelector("span")?.textContent ?? ""),
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
    return points.flatMap(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      if (el.contains(hit)) return [];
      const covering = hit instanceof HTMLElement ? hit.outerHTML : String(hit);
      return [`${Math.round(x)},${Math.round(y)}: ${covering.slice(0, 200)}`];
    });
  });
  expect(misses, "points of the button another element covers").toEqual([]);
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  api = createRefreshingApiClient(refreshingToken());
  await acceptTerms(api);
  await deleteAgentIfPresent(api, AGENT);
  const { id } = await api.agents.create.mutate({
    name: AGENT,
    templateId: harnessName,
  });
  agentIds.set(AGENT, id);
  await waitAgentState(api, id, "running");
});

test.afterAll(async () => {
  for (const id of agentIds.values()) await api.agents.delete.mutate({ id });
});

test("Sessions are listed newest first, and a turn moves its Session to the top", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const name = AGENT;
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
    await expect
      .poll(async () => (await shownSessions(page)).sort(), {
        timeout: 30_000,
        message:
          "each Session is titled by its first message, not '(no title · <id>)'",
      })
      .toEqual([...PROMPTS].sort());
  });

  const start = await shownSessions(page);
  const [newest, middle, oldest] = start as [string, string, string];
  const row = (title: string) =>
    sessionRows(page).filter({ hasText: title }).first();

  await test.step("the newest Session is at the top, and a row does not drag", async () => {
    await expect(row(newest)).toHaveAttribute("data-active", "true");
    await dragTo(page, row(newest), () => row(oldest), "bottom");
    await page.waitForTimeout(1_000);
    expect(await shownSessions(page)).toEqual([newest, middle, oldest]);
  });

  await test.step("a turn in the oldest Session moves it to the top, and its ⋯ button takes every click", async () => {
    await row(oldest).click();
    await expect(row(oldest)).toHaveAttribute("data-active", "true");
    await setMockLongTurnReply(api, agentId, {
      holdMs: 8_000,
      tail: "order-long-tail",
    });
    await sendMessageToAgent(page, "order-working");
    const working = sessionRows(page).and(page.locator('[data-active="true"]'));
    await expect(working.getByTestId("working-dots")).toBeAttached();
    await expect
      .poll(() => shownSessions(page), { timeout: 30_000 })
      .toEqual([oldest, newest, middle]);
    await working.hover();
    await expectFullHitArea(working.getByTestId("session-menu-button"));
    const menu = await working.getByTestId("session-menu-button").boundingBox();
    await page.mouse.click(menu!.x + 3, menu!.y + menu!.height - 3);
    await expect(page.getByTestId("session-rename-button")).toBeVisible();
    await expect(
      working.getByTestId("working-dots"),
      "the hold ended before the click, so the row was idle when it was clicked",
    ).toBeAttached();
    await page.keyboard.press("Escape");
    await expect(page.getByText("order-long-tail")).toBeVisible({
      timeout: 60_000,
    });
    expect(await shownSessions(page)).toEqual([oldest, newest, middle]);
  });

  await test.step("the order survives a reload", async () => {
    await reload(page);
    await ensureSidebarExpanded(page);
    await expect
      .poll(() => shownSessions(page))
      .toEqual([oldest, newest, middle]);
  });

  await test.step("a new Session goes to the top", async () => {
    await setMockAgentReply(api, agentId, reply);
    await newSession("order-fourth");
    await expect
      .poll(async () => (await shownSessions(page)).slice(1), {
        timeout: 30_000,
      })
      .toEqual([oldest, newest, middle]);
    const shown = await shownSessions(page);
    expect(shown[0]).not.toEqual("");
    expect(start).not.toContain(shown[0]);
  });
});
