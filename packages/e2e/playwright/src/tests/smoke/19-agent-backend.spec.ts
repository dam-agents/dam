// TEST_OVERVIEW: an agent is an agent like any other to its user, whichever Backend runs it. Both CI lanes run this spec, each on its own Backend: on the container lane the agent is a pod, on the vm lane a microVM on its owner's VM runner. On each, the agent boots, holds a chat turn, keeps a file written through the files API in HOME, takes a scheduled fire, and keeps that file across every way its sandbox goes down and comes back — hibernate and wake, the restart verb, and the pod that hosts it being deleted (the agent pod, or the owner's whole VM runner). HOME is the one path both Backends persist, so it is what each of those must keep. On the vm lane the runner it deletes also runs every other machine of its owner. As the dev user, the Playwright config runs this spec there only after the rest of the suite has finished; with E2E_OWN_USERS=1 it runs as a user of its own, whose runner hosts nothing else, beside the rest of the suite.
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  openAgentChat,
  sendMessageToAgent,
  setMockAgentReply,
} from "../../lib/agents.js";
import {
  type ApiClient,
  createRefreshingApiClient,
} from "../../lib/api-client.js";
import { acceptTerms } from "../../lib/auth.js";
import {
  createAgentOn,
  deleteBackendHost,
  expectHomeFile,
  laneBackend,
  refreshingToken,
  requireBackend,
  waitAgentState,
  writeHomeFile,
} from "../../lib/backend.js";
import { harnessName } from "../../lib/fixtures.js";
import { specUser } from "../../lib/own-users.js";

const markerPath = "e2e-backend-marker.txt";

test.describe.configure({ mode: "serial" });

let api: ApiClient;
const token = refreshingToken(specUser("agentBackend").user);
let agentId = "";
let agentName = "";
const marker = `home-survives-${randomUUID()}`;

async function chatTurn(
  page: Page,
  prompt: string,
  reply: string,
): Promise<void> {
  await setMockAgentReply(api, agentId, reply);
  await openAgentChat(page, agentName, agentId, { cardTimeoutMs: 120_000 });
  await sendMessageToAgent(page, prompt);
  await expect(page.getByText(reply)).toBeVisible({ timeout: 90_000 });
}

test.beforeAll(async () => {
  test.setTimeout(900_000);
  api = createRefreshingApiClient(token);
  await requireBackend(api, laneBackend);
  await acceptTerms(api);
  agentName = `e2e-${laneBackend}-lifecycle`;
  agentId = await createAgentOn(api, laneBackend, agentName, harnessName, {
    neverIdle: true,
  });
});

test.afterAll(async () => {
  if (agentId) await api.agents.delete.mutate({ id: agentId });
});

// TEST_SCENARIO: the first boot. On the vm Backend it may wait for the owner's VM runner to be created and the image to be mounted, so the wait is minutes rather than a pod's seconds. The chat turn proves the relay reaches the harness on this Backend.
test("boots and holds a chat turn", async ({ page }) => {
  test.setTimeout(900_000);
  await waitAgentState(api, agentId, "running");
  await chatTurn(page, "hello-backend", "backend-reply-first-boot");
});

// TEST_SCENARIO: the files API writes into the agent's HOME and reads the same bytes back. Every later scenario reads this file again, so it is the evidence that HOME survived.
test("keeps a file written to HOME", async () => {
  test.setTimeout(300_000);
  await writeHomeFile(token, agentId, markerPath, marker);
  await expectHomeFile(token, agentId, markerPath, marker, {
    timeoutMs: 60_000,
  });
});

// TEST_SCENARIO: a cron schedule's fire reaches the harness. The api-server delivers it over the runtime channel, the same path on both Backends, so a fire that never lands names the Backend's runtime channel as the broken part.
test("takes a scheduled fire", async () => {
  test.setTimeout(300_000);
  const task = `e2e-backend-schedule-${randomUUID()}`;
  const schedule = await api.schedules.createCron.mutate({
    name: "e2e-backend-cron",
    agentId,
    cron: "* * * * *",
    task,
    sessionMode: "fresh",
  });
  try {
    await expect
      .poll(
        async () => {
          const { prompts } = await api.e2e.getReceivedPrompts.query({
            agentId,
          });
          return JSON.stringify(prompts).includes(task);
        },
        {
          timeout: 180_000,
          intervals: [3_000],
          message: "the scheduled task never reached the agent",
        },
      )
      .toBe(true);
    const { status } = await api.schedules.get.query({ id: schedule.id });
    expect(status?.lastResult).toBe("success");
  } finally {
    await api.schedules.delete.mutate({ id: schedule.id });
  }
});

// TEST_SCENARIO: stop hibernates the agent, and wake brings it back. On the vm Backend that is a stop and a boot of the same machine, and HOME is its disk, so the marker must read back and the chat must answer after the boot.
test("hibernates and wakes with HOME intact", async ({ page }) => {
  test.setTimeout(900_000);
  await api.agents.stop.mutate({ id: agentId });
  await waitAgentState(api, agentId, "hibernated");
  await api.agents.wake.mutate({ id: agentId });
  await waitAgentState(api, agentId, "running");
  await expectHomeFile(token, agentId, markerPath, marker);
  await chatTurn(page, "hello-after-wake", "backend-reply-after-wake");
});

// TEST_SCENARIO: the restart verb takes the agent down and up again without a hibernation. The agent must be seen to leave running, or the verb did nothing, and it must come back with HOME intact.
test("restarts with HOME intact", async ({ page }) => {
  test.setTimeout(900_000);
  await api.agents.restart.mutate({ id: agentId });
  await expect
    .poll(async () => (await api.agents.get.query({ id: agentId })).state, {
      timeout: 180_000,
      intervals: [500],
      message: "the agent never left running after the restart verb",
    })
    .not.toBe("running");
  await waitAgentState(api, agentId, "running", { failOnError: false });
  await expectHomeFile(token, agentId, markerPath, marker);
  await chatTurn(page, "hello-after-restart", "backend-reply-after-restart");
});

// TEST_SCENARIO: the pod that hosts the agent is deleted out from under it: the agent pod on the container Backend, the owner's VM runner — and with it every machine it runs — on the vm Backend. Nothing asked for it, so nothing but the controller's reconcile brings the machine back, and HOME must still be on the disk it boots.
test("comes back after its host pod is deleted, with HOME intact", async ({
  page,
}) => {
  test.setTimeout(1_200_000);
  await deleteBackendHost(agentId, laneBackend);
  await waitAgentState(api, agentId, "running", { failOnError: false });
  await expectHomeFile(token, agentId, markerPath, marker);
  await chatTurn(page, "hello-after-host-loss", "backend-reply-after-host");
});
