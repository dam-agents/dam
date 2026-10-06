import { expect, test } from "@playwright/test";

import { setMockAgentReply, waitForAgentRunning } from "../../lib/agents.js";
import { type ApiClient, createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { harnessName } from "../../lib/fixtures.js";

const cases: {
  title: string;
  agentName: string;
  create: (
    api: ApiClient,
    agentId: string,
    task: string,
  ) => Promise<{ id: string }>;
}[] = [
  {
    title: "cron schedule fires and reaches the mock (#435)",
    agentName: "e2e-schedule-agent",
    create: (api, agentId, task) =>
      api.schedules.createCron.mutate({
        name: "e2e-cron",
        agentId,
        cron: "* * * * *",
        task,
        sessionMode: "fresh",
      }),
  },
  {
    title: "rrule schedule fires and reaches the mock",
    agentName: "e2e-rrule-schedule-agent",
    create: (api, agentId, task) =>
      api.schedules.createRRule.mutate({
        name: "e2e-rrule",
        agentId,
        rrule: "FREQ=MINUTELY",
        timezone: "Europe/Prague",
        task,
        sessionMode: "fresh",
      }),
  },
];

for (const { title, agentName, create } of cases) {
  // TEST_SCENARIO: a schedule is saved and its fire reaches the harness. The rrule case runs the occurrence search inside the shipped api-server image, so it fails when that image's Node cannot resolve a timezone, which unit tests on a developer's Node never see.
  test(title, async () => {
    test.setTimeout(600_000);

    const api = createApiClient(await getAccessToken());
    await acceptTerms(api);

    const { id: agentId } = await api.agents.create.mutate({
      name: agentName,
      templateId: harnessName,
    });

    const task = `${agentName}-sentinel`;
    let scheduleId = "";
    try {
      await waitForAgentRunning(api, agentName);
      await setMockAgentReply(api, agentId, "scheduled reply");

      scheduleId = (await create(api, agentId, task)).id;

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
}
