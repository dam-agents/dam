import { expect, test } from "@playwright/test";

import { baseUrl } from "../config.js";
import { waitForAgentRunning } from "../lib/agents.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";

// Compute budgets (#1900), end to end: Sizes reserve room while a sandbox is
// up; a start that doesn't fit PARKS (never fails) with the figures on the
// badge; freeing room plus a deliberate Start recovers it on the first try.
//
// Sizes are picked so two boxes overflow the chart's default 4-CPU ceiling
// regardless of whether earlier specs' shared agent (≤1 CPU) is still
// running: box-1 fits even beside it (3+1 ≤ 4), box-2 never does (6 > 4).
const BOX1 = "e2e-budget-box-1";
const BOX2 = "e2e-budget-box-2";
const SIZE = { cpu: "3", memory: "1Gi" };

test("budgets: over-budget start parks, freeing room recovers it", async ({
  page,
}) => {
  test.setTimeout(300_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  await test.step("clean slate", async () => {
    for (const a of await api.agents.list.query()) {
      if (a.name === BOX1 || a.name === BOX2)
        await api.agents.delete.mutate({ id: a.id });
    }
  });

  let box1Id = "";
  await test.step("box-1 (3 CPU) starts and reserves room", async () => {
    await api.agents.create.mutate({
      name: BOX1,
      templateId: "mock",
      size: SIZE,
    });
    box1Id = await waitForAgentRunning(api, BOX1);
  });

  let box2Id = "";
  await test.step("box-2 (3 CPU) is admitted but parks over budget", async () => {
    // Creates are never rejected — the sandbox lands parked.
    const created = await api.agents.create.mutate({
      name: BOX2,
      templateId: "mock",
      size: SIZE,
    });
    box2Id = created.id;
    await expect
      .poll(async () => (await api.agents.get.query({ id: box2Id })).state, {
        timeout: 60_000,
        intervals: [2_000],
        message: "box-2 did not park as over_budget",
      })
      .toBe("over_budget");
  });

  await test.step("the list shows the badge, the figures, and the meter", async () => {
    await page.goto(baseUrl);
    const row2 = page.getByTestId("agent-row").filter({ hasText: BOX2 });
    await expect(row2.getByText("Over budget")).toBeVisible();
    // The controller's reserved/ceiling figures ride the badge as a
    // focusable, labelled note (keyboard/screen-reader reachable).
    await expect(row2.getByRole("note")).toHaveAttribute("aria-label", /CPU/);
    await expect(page.getByTitle(/against your budget/)).toBeVisible();
  });

  await test.step("box-2 stays parked while room is still short", async () => {
    // Parked sandboxes never grab room by themselves; without a freed slot
    // even a poll-heavy UI must not resurrect it.
    await page.waitForTimeout(5_000);
    expect((await api.agents.get.query({ id: box2Id })).state).toBe(
      "over_budget",
    );
  });

  await test.step("stop box-1 to free room", async () => {
    const row1 = page.getByTestId("agent-row").filter({ hasText: BOX1 });
    await row1.getByRole("button", { name: "Sandbox actions" }).click();
    await page
      .getByRole("menuitem", { name: /stop — until started again/i })
      .click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect
      .poll(async () => (await api.agents.get.query({ id: box1Id })).state, {
        timeout: 60_000,
        intervals: [2_000],
        message: "box-1 did not stop",
      })
      .toBe("hibernated");
  });

  await test.step("box-2 starts on the first try once room is free", async () => {
    // The recovery path this feature's review fought over: stop B, start A,
    // and the stale parked condition must not fail the wake.
    const row2 = page.getByTestId("agent-row").filter({ hasText: BOX2 });
    await row2.getByRole("button", { name: "Sandbox actions" }).click();
    await page.getByRole("menuitem", { name: "Start" }).click();
    await waitForAgentRunning(api, BOX2);
  });

  await test.step("cleanup", async () => {
    await api.agents.delete.mutate({ id: box1Id });
    await api.agents.delete.mutate({ id: box2Id });
  });
});
