import { expect, type Locator, type Page } from "@playwright/test";

import { baseUrl } from "../../config.js";
import type { Person } from "../../people.js";

export interface Pages {
  of(person: Person): Promise<Page>;
  fresh(person: Person): Promise<Page>;
}

export const agentUp = /^(Running|Working|Idle)$/;

export async function openHome(page: Page): Promise<void> {
  await page.goto(baseUrl);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

export function agentCard(page: Page, name: string) {
  return page
    .getByTestId("agent-row")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
}

/** UNIT_BOUNDARY_DESCRIPTION: waits until a page shows, or no longer shows, what a change made elsewhere decides, opening the page afresh between looks, as a person reloads one that has not caught up. */
export async function untilShown(
  page: Page,
  open: () => Promise<void>,
  locator: Locator,
  shown: boolean,
  timeout = 90_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await open();
        await page.waitForLoadState("networkidle").catch(() => {});
        return (await locator.count()) > 0;
      },
      { timeout, intervals: [3_000] },
    )
    .toBe(shown);
}
