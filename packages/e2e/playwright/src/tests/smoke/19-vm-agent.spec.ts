// TEST_OVERVIEW: an agent on the vm backend is an agent like any other to its user. Created with the vm backend, it boots as a microVM on its owner's VM runner, reaches running, and holds a conversation through the same chat as a pod; stopped, it hibernates, and woken, it comes back on its runner and answers again. The spec needs an install with virtualization enabled — a host with KVM — and is skipped on any other, which is every CI runner.
import { expect, test } from "@playwright/test";
import type { AgentState } from "api-server-api";

import { baseUrl } from "../../config.js";
import {
  AGENT_UP,
  agentCardStatus,
  chatInput,
  gotoAgentChat,
  sendMessageToAgent,
  setMockAgentReply,
} from "../../lib/agents.js";
import { type ApiClient, createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { harnessName } from "../../lib/fixtures.js";

const vmAgentName = "e2e-vm-agent";
const firstReply = "vm-reply-before-hibernate";
const secondReply = "vm-reply-after-wake";

async function waitState(
  api: ApiClient,
  agentId: string,
  state: AgentState,
): Promise<void> {
  await expect
    .poll(async () => (await api.agents.get.query({ id: agentId })).state, {
      timeout: 600_000,
      intervals: [2_000],
      message: `vm agent ${agentId} did not reach ${state}`,
    })
    .toBe(state);
}

// TEST_SCENARIO: the whole life of a vm agent a user sees — create, chat, hibernate, wake, chat again. The first boot may unpack the image onto the runner, and a wake boots the machine again, so both waits are measured in minutes rather than the seconds a pod takes.
test("a vm agent chats, hibernates and wakes", async ({ page }) => {
  test.setTimeout(1_500_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  await acceptTerms(api);

  const install = await api.features.install.query();
  test.skip(
    !install.virtualization,
    "this install has no vm backend (virtualization.enabled is off)",
  );

  let agentId = "";
  try {
    await test.step("create the agent on the vm backend", async () => {
      const created = await api.agents.create.mutate({
        name: vmAgentName,
        templateId: harnessName,
        vm: true,
      });
      agentId = created.id;
      expect(created.vm, "the agent was created on the container backend").toBe(
        true,
      );
      await waitState(api, agentId, "running");
    });

    await test.step("chat with the agent", async () => {
      await setMockAgentReply(api, agentId, firstReply);
      await page.goto(baseUrl);
      await expect(page.getByTestId("app-sidebar")).toBeVisible();
      await expect(agentCardStatus(page, vmAgentName, AGENT_UP)).toBeVisible({
        timeout: 60_000,
      });
      await gotoAgentChat(page, vmAgentName, agentId);
      await expect(chatInput(page)).toBeVisible();
      await sendMessageToAgent(page, "hello-vm");
      await expect(page.getByText(firstReply)).toBeVisible({
        timeout: 60_000,
      });
    });

    await test.step("hibernate the agent", async () => {
      await api.agents.stop.mutate({ id: agentId });
      await waitState(api, agentId, "hibernated");
    });

    await test.step("wake the agent and chat again", async () => {
      await api.agents.wake.mutate({ id: agentId });
      await waitState(api, agentId, "running");
      await setMockAgentReply(api, agentId, secondReply);
      await page.reload();
      await expect(chatInput(page)).toBeVisible({ timeout: 60_000 });
      await sendMessageToAgent(page, "hello-again-vm");
      await expect(page.getByText(secondReply)).toBeVisible({
        timeout: 60_000,
      });
    });
  } finally {
    if (agentId) await api.agents.delete.mutate({ id: agentId });
  }
});
