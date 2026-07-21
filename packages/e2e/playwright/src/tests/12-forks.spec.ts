import { expect, test } from "@playwright/test";

import { testUser2 } from "../config.js";
import { waitForAgentRunning } from "../lib/agents.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";
import { agentName } from "../lib/fixtures.js";

// Durable per-replier forks (#2843). Builds on 07-slack's groundwork: the
// foreign user (testUser2) is already identity-linked there, so this spec
// only rebinds the agent to its own channel and drives turns. Hibernation
// and expiry are deliberately NOT tested here — timer mechanics are
// unit-covered and would add minutes of dead wall-clock to a serial suite;
// `forks.end` exercises the same teardown-and-GC path instantly.
const slackChannelId = "C-E2E-FORKS";
const foreignSlackUserId = "U-E2E-FOREIGN";
const mockDefaultReply = "Hello from the mock agent.";

async function fireForeignMention(
  api: ReturnType<typeof createApiClient>,
  ts: string,
  text: string,
): Promise<void> {
  await api.e2e.slackResetOutbound.mutate();
  await api.e2e.slackFireMention.mutate({
    user: foreignSlackUserId,
    channel: slackChannelId,
    ts,
    text,
  });
}

async function pollForReply(
  api: ReturnType<typeof createApiClient>,
  message: string,
  match: (text: string) => boolean = (t) => t.includes(mockDefaultReply),
): Promise<void> {
  await expect
    .poll(
      async () => {
        const { records } = await api.e2e.slackReadOutbound.query();
        return records.some((r) => r.kind === "message" && match(r.text));
      },
      { timeout: 300_000, intervals: [5_000], message },
    )
    .toBe(true);
}

test("forks are durable per replier: reused across threads, budgeted, endable, deterministic", async () => {
  test.setTimeout(600_000);

  const api = createApiClient(await getAccessToken());
  const foreignApi = createApiClient(await getAccessToken(testUser2));
  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("bind the agent to this spec's channel", async () => {
    await api.agents.connectSlack.mutate({ id: agentId, slackChannelId });
  });

  let forkId = "";
  await test.step("first foreign mention creates the fork", async () => {
    await fireForeignMention(api, "1700000012.000100", "hello fork");
    await pollForReply(api, "first foreign reply did not land");

    const forks = await api.forks.listByAgent.query({ agentId });
    expect(forks).toHaveLength(1);
    forkId = forks[0]!.forkId;
    expect(forks[0]!.replierSub).not.toBe("");
    expect(forks[0]!.podRunning).toBe(true);
  });

  await test.step("the fork reserves against the replier's budget", async () => {
    const reserved = await foreignApi.budgets.reserved.query();
    expect(reserved.cpu.reservedMilli).toBeGreaterThan(0);

    const mine = await foreignApi.forks.listMine.query();
    expect(mine.map((f) => f.forkId)).toContain(forkId);
  });

  await test.step("a second thread reuses the same fork — no per-turn pods", async () => {
    await fireForeignMention(api, "1700000012.000200", "hello again");
    await pollForReply(api, "second foreign reply did not land");

    const forks = await api.forks.listByAgent.query({ agentId });
    expect(forks).toHaveLength(1);
    expect(forks[0]!.forkId).toBe(forkId);
  });

  await test.step("egress needing a verdict auto-declines — the owner's inbox stays empty", async () => {
    // No egress rule exists for this host, so the request would previously
    // hold a pending approval in the owner's inbox mid-turn. Foreign turns
    // must instead fail closed and settle without a human in the loop —
    // the reply landing (rather than hanging on a verdict) is the proof.
    await fireForeignMention(
      api,
      "1700000012.000300",
      "__FETCH__ https://fork-decline-probe.example/secret",
    );
    await pollForReply(
      api,
      "auto-declined turn did not settle",
      (t) => t.length > 0,
    );

    const pending = await api.approvals.listForInstance.query({
      agentId,
      status: "pending",
    });
    expect(pending).toEqual([]);
  });

  await test.step("the replier ends the fork and the reservation frees", async () => {
    await foreignApi.forks.end.mutate({ forkId });

    await expect
      .poll(
        async () => (await api.forks.listByAgent.query({ agentId })).length,
        { timeout: 60_000, message: "ended fork did not disappear" },
      )
      .toBe(0);

    const reserved = await foreignApi.budgets.reserved.query();
    expect(reserved.cpu.reservedMilli).toBe(0);
  });

  await test.step("the next mention rebuilds the slot under the same deterministic id", async () => {
    await fireForeignMention(api, "1700000012.000400", "hello once more");
    await pollForReply(api, "post-end foreign reply did not land");

    const forks = await api.forks.listByAgent.query({ agentId });
    expect(forks).toHaveLength(1);
    expect(forks[0]!.forkId).toBe(forkId);
  });
});
