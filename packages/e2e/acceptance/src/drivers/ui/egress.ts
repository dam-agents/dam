import { expect, type Page } from "@playwright/test";

import { baseUrl } from "../../config.js";
import type { World } from "../../world.js";
import type { EgressDriver, EgressRequest } from "../driver.js";
import { agentCard, openHome, type Pages } from "./pages.js";

const named = (r: EgressRequest) => `${r.method} ${r.host}${r.path}`;

async function openNetwork(page: Page, agentId: string): Promise<void> {
  await page.goto(
    `${baseUrl}/sandboxes/${encodeURIComponent(agentId)}/network`,
  );
  await expect(page.getByTestId("egress-rule-new")).toBeVisible();
}

async function approvalCards(page: Page) {
  await openHome(page);
  await page.getByTestId("side-panel-tab-approvals").click();
  return page.getByTestId("feed-approval-card");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an agent's egress in the web UI: the Network section of its settings, where the owner writes and reads its rules, the approvals list on Home, where a waiting request is answered, and the prompt a chat shows for its agent's waiting requests. A rule an example writes is revoked when it ends, through the API.
 */
export function uiEgress(world: World, pages: Pages): EgressDriver {
  const openChat = async (
    person: Parameters<EgressDriver["openChat"]>[0],
    agentName: string,
  ) => {
    const page = await pages.of(person);
    const agent = world.agent(agentName);
    await openHome(page);
    await agentCard(page, agent.name)
      .getByRole("heading", { name: agent.name, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/chat/${agent.id}`));
  };
  return {
    async allow(person, agentName, method, host, pathPattern) {
      const page = await pages.of(person);
      const agentId = world.agent(agentName).id;
      await openNetwork(page, agentId);
      await page.getByTestId("egress-rule-new").click();
      const dialog = page.getByRole("dialog", { name: "New rule" });
      await dialog.getByLabel("Host").fill(host);
      await dialog.getByLabel("Method").selectOption(method);
      await dialog.getByLabel("Path").fill(pathPattern);
      await dialog.getByLabel("Verdict").selectOption("allow");
      await dialog.getByRole("button", { name: "Create rule" }).click();
      await page.getByRole("button", { name: "Add and restart" }).click();
      let ruleId = "";
      await expect
        .poll(
          async () => {
            ruleId =
              (
                await person.api.egressRules.listForAgent.query({ agentId })
              ).find((r) => r.host === host && r.pathPattern === pathPattern)
                ?.id ?? "";
            return ruleId;
          },
          { timeout: 30_000, message: "the rule was not kept" },
        )
        .not.toBe("");
      world.undo.push(() =>
        person.api.egressRules.revoke.mutate({ id: ruleId }),
      );
    },
    async expectRule(person, agentName, rule, present) {
      const page = await pages.of(person);
      const shown = async () => {
        await openNetwork(page, world.agent(agentName).id);
        const rows = await page
          .locator(`[title^="${rule.host}"]`)
          .evaluateAll((els) =>
            els.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()),
          );
        return rows.some((text) =>
          rule.pathPattern === "*"
            ? /^\S+$/.test(text)
            : text.endsWith(` ${rule.pathPattern}`),
        );
      };
      await expect
        .poll(shown, { timeout: 60_000, intervals: [3_000] })
        .toBe(present);
    },
    async expectWaiting(person, agentName, request) {
      const page = await pages.of(person);
      const cards = await approvalCards(page);
      if (request === undefined)
        await expect(
          cards.filter({ hasText: world.agent(agentName).name }),
        ).toHaveCount(0);
      else
        await expect(cards.filter({ hasText: named(request) })).toBeVisible({
          timeout: 30_000,
        });
    },
    async answer(person, agentName, verdict) {
      const page = await pages.of(person);
      const held = world.held.get(agentName);
      expect(held, `${agentName} holds no request`).toBeDefined();
      const path = new URL(held!.url);
      const card = (await approvalCards(page)).filter({
        hasText: `${path.hostname}${path.pathname}`,
      });
      if (verdict === "once")
        await card.getByRole("button", { name: "Allow once" }).click();
      else {
        await card
          .getByRole("button", { name: "More approval actions" })
          .click();
        await page.getByRole("menuitem", { name: "Always allow…" }).click();
        await page
          .getByRole("button", { name: "Allow & restart" })
          .click({ timeout: 5_000 })
          .catch(() => {});
      }
    },
    openChat,
    async expectWaitingInChat(person, _agentName, request) {
      const page = await pages.of(person);
      await expect(
        page
          .getByTestId("chat-egress-approval")
          .filter({ hasText: named(request) }),
      ).toBeVisible({ timeout: 30_000 });
    },
    async answerOnceInChat(person, agentName) {
      const page = await pages.of(person);
      await openChat(person, agentName);
      const prompt = page.getByTestId("chat-egress-approval").first();
      await prompt.getByRole("button", { name: "Allow once" }).click();
      await expect(prompt).toBeHidden({ timeout: 30_000 });
    },
  };
}
