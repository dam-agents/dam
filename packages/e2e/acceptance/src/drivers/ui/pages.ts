import { expect, type Page } from "@playwright/test";

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
