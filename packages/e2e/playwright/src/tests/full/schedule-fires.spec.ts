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

// TEST_SCENARIO: a one-time task, run now or at a moment two minutes out, reaches the harness once and records success only when its trigger settles on the pod, and Run now is refused for it since a run beside its own would do the task twice.
test("one-time tasks fire once and record their delivery", async () => {
  test.setTimeout(600_000);

  const api = createApiClient(await getAccessToken());
  await acceptTerms(api);

  const agentName = "e2e-once-schedule-agent";
  const { id: agentId } = await api.agents.create.mutate({
    name: agentName,
    templateId: harnessName,
  });

  const scheduleIds: string[] = [];
  try {
    await waitForAgentRunning(api, agentName);
    await setMockAgentReply(api, agentId, "one-time reply");

    const at = new Date(Date.now() + 2 * 60_000).toISOString().slice(0, 16);
    const now = await api.schedules.createOnce.mutate({
      name: "e2e-once-now",
      agentId,
      timezone: "UTC",
      task: `${agentName}-now`,
    });
    const later = await api.schedules.createOnce.mutate({
      name: "e2e-once-at",
      agentId,
      timezone: "UTC",
      at,
      task: `${agentName}-at`,
    });
    scheduleIds.push(now.id, later.id);

    await expect(api.schedules.runNow.mutate({ id: now.id })).rejects.toThrow(
      /runs only at its own moment/,
    );

    await expect
      .poll(
        async () => {
          const { prompts } = await api.e2e.getReceivedPrompts.query({
            agentId,
          });
          const seen = JSON.stringify(prompts);
          return [`${agentName}-now`, `${agentName}-at`].filter((t) =>
            seen.includes(t),
          ).length;
        },
        {
          timeout: 300_000,
          intervals: [3_000],
          message: "a one-time task never reached the mock",
        },
      )
      .toBe(2);

    for (const id of scheduleIds) {
      await expect
        .poll(
          async () =>
            (await api.schedules.get.query({ id })).status?.lastResult,
          { timeout: 60_000, intervals: [2_000] },
        )
        .toBe("success");
      const { status } = await api.schedules.get.query({ id });
      expect(status?.nextRun ?? null).toBeNull();
    }
    const { prompts } = await api.e2e.getReceivedPrompts.query({ agentId });
    const seen = JSON.stringify(prompts);
    for (const task of [`${agentName}-now`, `${agentName}-at`])
      expect(seen.split(task).length - 1).toBe(1);
  } finally {
    for (const id of scheduleIds)
      await api.schedules.delete.mutate({ id }).catch(() => {});
    await api.agents.delete.mutate({ id: agentId });
  }
});
