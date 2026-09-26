// TEST_OVERVIEW: an agent on the vm backend is an agent like any other to its user. Created with the vm backend, it boots as a microVM on its owner's VM runner, reaches running, and holds a conversation through the same chat as a pod; stopped, it hibernates, and woken, it comes back on its runner and answers again. The spec needs an install with virtualization enabled — a host with KVM — and is skipped on any other, which is every CI runner.
import { expect, test } from "@playwright/test";
import type { AgentState } from "api-server-api";

import {
  chatInput,
  openAgentChat,
  sendMessageToAgent,
  setMockAgentReply,
} from "../../lib/agents.js";
import { type ApiClient, createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { harnessName } from "../../lib/fixtures.js";

const vmAgentName = "e2e-vm-agent";
const firstReply = "vm-reply-before-hibernate";
const secondReply = "vm-reply-after-wake";

const stateTimeoutMs = 600_000;

async function waitState(
  api: ApiClient,
  agentId: string,
  state: AgentState,
): Promise<void> {
  const deadline = Date.now() + stateTimeoutMs;
  for (;;) {
    const agent = await api.agents.get.query({ id: agentId });
    if (agent.state === state) return;
    if (agent.state === "error")
      throw new Error(
        `vm agent ${agentId} failed on its way to ${state}: ${agent.podTerminationReason ?? "no reason reported"}`,
      );
    if (Date.now() > deadline)
      throw new Error(
        `vm agent ${agentId} did not reach ${state}; it is ${agent.state}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

let api: ApiClient | undefined;
let agentId = "";

test.afterEach(async () => {
  if (api && agentId) await api.agents.delete.mutate({ id: agentId });
  agentId = "";
});

// TEST_SCENARIO: the whole life of a vm agent a user sees — create, chat, hibernate, wake, chat again. The first boot may unpack the image onto the runner, and a wake boots the machine again, so both waits are measured in minutes rather than the seconds a pod takes.
test("a vm agent chats, hibernates and wakes", async ({ page }) => {
  test.setTimeout(2_400_000);

  const client = createApiClient(await getAccessToken());
  const install = await client.features.install.query();
  test.skip(
    !install.virtualization,
    "this install has no vm backend (virtualization.enabled is off)",
  );
  api = client;
  await acceptTerms(client);

  await test.step("create the agent on the vm backend", async () => {
    const created = await client.agents.create.mutate({
      name: vmAgentName,
      templateId: harnessName,
      vm: true,
    });
    agentId = created.id;
    expect(created.vm, "the agent was created on the container backend").toBe(
      true,
    );
    await waitState(client, agentId, "running");
  });

  await test.step("chat with the agent", async () => {
    await setMockAgentReply(client, agentId, firstReply);
    await openAgentChat(page, vmAgentName, agentId, { cardTimeoutMs: 60_000 });
    await sendMessageToAgent(page, "hello-vm");
    await expect(page.getByText(firstReply)).toBeVisible({
      timeout: 60_000,
    });
  });

  await test.step("hibernate the agent", async () => {
    await client.agents.stop.mutate({ id: agentId });
    await waitState(client, agentId, "hibernated");
  });

  await test.step("wake the agent and chat again", async () => {
    await client.agents.wake.mutate({ id: agentId });
    await waitState(client, agentId, "running");
    await setMockAgentReply(client, agentId, secondReply);
    await page.reload();
    await expect(chatInput(page)).toBeVisible({ timeout: 60_000 });
    await sendMessageToAgent(page, "hello-again-vm");
    await expect(page.getByText(secondReply)).toBeVisible({
      timeout: 60_000,
    });
  });
});
