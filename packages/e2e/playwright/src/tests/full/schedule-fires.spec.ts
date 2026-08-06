import { expect, test } from "@playwright/test";

import { setMockAgentReply, waitForAgentRunning } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { harnessName } from "../../lib/fixtures.js";

const agentName = "e2e-schedule-agent";
const task = "e2e-schedule-fires-sentinel";

test("cron schedule fires and reaches the mock (#435)", async () => {
  test.setTimeout(600_000);

  const api = createApiClient(await getAccessToken());
  await acceptTerms(api);

  const { id: agentId } = await api.agents.create.mutate({
    name: agentName,
    templateId: harnessName,
  });

  let scheduleId = "";
  try {
    await waitForAgentRunning(api, agentName);
    await setMockAgentReply(api, agentId, "scheduled reply");

    const schedule = await api.schedules.createCron.mutate({
      name: "e2e-cron",
      agentId,
      cron: "* * * * *",
      task,
      sessionMode: "fresh",
    });
    scheduleId = schedule.id;

    await expect
      .poll(
        async () => {
          const { prompts } = await api.e2e.getReceivedPrompts.query({
            agentId,
          });
          return JSON.stringify(prompts).includes(task);
        },
        {
          timeout: 120_000,
          intervals: [3_000],
          message: "scheduled task never reached the mock",
        },
      )
      .toBe(true);

    const { status } = await api.schedules.get.query({ id: scheduleId });
    expect(status?.lastResult).toBe("success");
    expect(status?.lastRun).toBeTruthy();
    expect(status?.nextRun).toBeTruthy();
  } finally {
    if (scheduleId) await api.schedules.delete.mutate({ id: scheduleId });
    await api.agents.delete.mutate({ id: agentId });
  }
});
