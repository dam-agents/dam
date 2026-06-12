import { expect, type Locator, type Page } from "@playwright/test";

import type { ApiClient } from "./api-client.js";

export async function waitForAgentRunning(
  api: ApiClient,
  agentName: string,
): Promise<string> {
  let agentId = "";
  await expect
    .poll(
      async () => {
        const list = await api.agents.list.query();
        const found = list.find((a) => a.name === agentName);
        if (found) agentId = found.id;
        return Boolean(found);
      },
      { timeout: 30_000, message: `agent ${agentName} not in list` },
    )
    .toBe(true);

  await expect
    .poll(
      async () => {
        const agent = await api.agents.get.query({ id: agentId });
        return agent.state;
      },
      {
        timeout: 180_000,
        intervals: [2_000],
        message: `agent ${agentId} did not reach running state`,
      },
    )
    .toBe("running");

  return agentId;
}

// HACK: UI doesn't pick up new agent without a reload (bug)
export async function reloadUntilAgentVisible(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByText("Running")).toBeVisible();
}

export async function gotoAgentDetail(
  page: Page,
  agentName: string,
  agentId: string,
): Promise<void> {
  await page.getByRole("heading", { name: agentName }).click();
  await expect(page).toHaveURL(
    new RegExp(`/chat/${encodeURIComponent(agentId)}`),
  );
}

export async function sendMessageToAgent(
  page: Page,
  message: string,
): Promise<void> {
  const input = page.getByPlaceholder(/message agent/i);
  await expect(input).toBeVisible();
  await input.fill(message);
  await input.press("Enter");
}

export async function setMockAgentReply(
  api: ApiClient,
  agentId: string,
  reply: string,
): Promise<void> {
  await api.e2e.setScript.mutate({
    agentId,
    script: {
      entries: [
        {
          sessionUpdate: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: reply },
          },
        },
      ],
      stopReason: "end_turn",
    },
  });
}

export async function setMockReplyWithFiles(
  api: ApiClient,
  agentId: string,
  reply: string,
  files: { path: string; content: string }[],
): Promise<void> {
  await api.e2e.setScript.mutate({
    agentId,
    script: {
      entries: [
        {
          sessionUpdate: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: reply },
          },
        },
      ],
      files,
      stopReason: "end_turn",
    },
  });
}

export async function setMockReplyWithMidTurnUserPrompt(
  api: ApiClient,
  agentId: string,
  parts: { head: string; midTurnUserPrompt: string; tail: string },
): Promise<void> {
  await api.e2e.setScript.mutate({
    agentId,
    script: {
      entries: [
        {
          sessionUpdate: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: parts.head },
          },
        },
        {
          delayMs: 200,
          sessionUpdate: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: parts.midTurnUserPrompt },
            _meta: { queued: true },
          },
        },
        {
          delayMs: 200,
          sessionUpdate: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: parts.tail },
          },
        },
      ],
      stopReason: "end_turn",
    },
  });
}

export async function readChatMessages(
  page: Page,
): Promise<{ role: string | null; text: string }[]> {
  const nodes = await page.getByTestId("chat-message").all();
  const rows: { role: string | null; text: string }[] = [];
  for (const node of nodes) {
    rows.push({
      role: await node.getAttribute("data-role"),
      text: await node.innerText(),
    });
  }
  return rows;
}

export function agentNameHeading(page: Page, agentName: string): Locator {
  return page.getByRole("heading", { name: agentName, exact: true });
}

export function agentCardStatus(
  page: Page,
  agentName: string,
  label: string,
): Locator {
  return page
    .getByTestId("agent-row")
    .filter({ has: agentNameHeading(page, agentName) })
    .getByText(label, { exact: true });
}
