import { expect, type Locator, type Page } from "@playwright/test";

import type { ApiClient } from "./api-client.js";

const AGENT_RUNNING_TIMEOUT_MS = 180_000;

export async function waitForAgentRunning(
  api: ApiClient,
  agentName: string,
  { timeoutMs = AGENT_RUNNING_TIMEOUT_MS }: { timeoutMs?: number } = {},
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
        timeout: timeoutMs,
        intervals: [2_000],
        message: `agent ${agentId} did not reach running state`,
      },
    )
    .toBe("running");

  return agentId;
}

export async function deleteAgentIfPresent(
  api: ApiClient,
  agentName: string,
): Promise<void> {
  const found = (await api.agents.list.query()).find(
    (a) => a.name === agentName,
  );
  if (!found) return;

  await api.agents.delete.mutate({ id: found.id });
  await expect
    .poll(
      async () =>
        (await api.agents.list.query()).some((a) => a.name === agentName),
      {
        timeout: 120_000,
        intervals: [2_000],
        message: `agent ${agentName} was not deleted`,
      },
    )
    .toBe(false);
}

export async function ensureAgentExists(
  api: ApiClient,
  agentName: string,
  templateId: string,
): Promise<void> {
  const list = await api.agents.list.query();
  if (list.some((a) => a.name === agentName)) return;
  await api.agents.create.mutate({ name: agentName, templateId });
}

export function chatInput(page: Page): Locator {
  return page.getByPlaceholder(/^(queue a )?message\.\.\./i);
}

export async function gotoAgentChat(
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
  const input = chatInput(page);
  await expect(input).toBeVisible();
  await input.fill(message);
  await input.press("Enter");
}

export async function setMockAgentReply(
  api: ApiClient,
  agentId: string,
  reply: string,
  files?: { path: string; content: string }[],
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

export async function setMockLongTurnReply(
  api: ApiClient,
  agentId: string,
  parts: { head?: string; holdMs: number; tail: string },
): Promise<void> {
  await api.e2e.setScript.mutate({
    agentId,
    script: {
      entries: [
        ...(parts.head === undefined
          ? []
          : [
              {
                sessionUpdate: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: parts.head },
                },
              },
            ]),
        {
          delayMs: parts.holdMs,
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

export const AGENT_UP = /^(Running|Working|Idle)$/;

export function agentCardStatus(
  page: Page,
  agentName: string,
  label: string | RegExp,
): Locator {
  return page
    .getByTestId("agent-row")
    .filter({
      has: page.getByRole("heading", { name: agentName, exact: true }),
    })
    .getByText(label, { exact: true });
}
