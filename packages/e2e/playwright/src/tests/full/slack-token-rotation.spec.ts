import { expect, test } from "@playwright/test";

import { ensureAgentExists, waitForAgentRunning } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { harnessName } from "../../lib/fixtures.js";

const agentName = "e2e-slack-rotation";

const helmTeamId = "T-E2E-HELM";
const helmToken = "xoxb-e2e-helm-token";
const connectedTeamId = "T-E2E-ROTATING";
const connectedToken = "xoxb-e2e-rotating-workspace";
const legacyChannel = "C-E2E-ROT-LEGACY";
const slackUserId = "U-E2E-ROT";
const mockDefaultReply = "Hello from the mock agent.";

const HOUR_S = 3600;
const EXCHANGE_RETRY_S = 11 * 60;

async function replyIn(api: ReturnType<typeof createApiClient>) {
  const { records } = await api.e2e.slackReadOutbound.query();
  return records.find(
    (r) =>
      r.kind === "message" &&
      r.channel === legacyChannel &&
      r.text.includes(mockDefaultReply),
  );
}

test("Slack bot tokens import from Helm, exchange for rotating ones and refresh", async () => {
  test.setTimeout(360_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  await acceptTerms(api);
  await ensureAgentExists(api, agentName, harnessName);
  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("a binding made before multi-workspace support names no workspace", async () => {
    await api.e2e.slackSetChannels.mutate({
      channels: [{ id: legacyChannel, name: "legacy", botIsMember: true }],
    });
    await api.agents.disconnectSlack.mutate({ id: agentId });
    await api.agents.connectSlack.mutate({
      id: agentId,
      slackChannelId: legacyChannel,
    });
  });

  await test.step("the Helm token becomes its workspace's row and the binding moves onto it", async () => {
    await api.e2e.slackImportHelmToken.mutate({
      teamId: helmTeamId,
      botToken: helmToken,
    });
    expect(await api.e2e.slackTokenState.query({ teamId: helmTeamId })).toEqual(
      { token: helmToken, live: true },
    );

    await api.e2e.slackResetOutbound.mutate();
    await api.e2e.slackFireMention.mutate({
      user: slackUserId,
      channel: legacyChannel,
      ts: "1700001000.000100",
      text: "hello after the import",
      teamId: helmTeamId,
    });
    await expect
      .poll(() => replyIn(api).then(Boolean), {
        timeout: 180_000,
        intervals: [5_000],
        message: `no reply landed in ${legacyChannel}`,
      })
      .toBe(true);
    expect(await replyIn(api)).toMatchObject({ teamId: helmTeamId });
  });

  await test.step("while the Slack app has rotation off, tokens stay as they are", async () => {
    await api.e2e.slackConnectWorkspace.mutate({
      teamId: connectedTeamId,
      botToken: connectedToken,
      channels: [],
    });
    await api.e2e.slackRenewTokens.mutate({ advanceSeconds: 0 });

    expect(
      await api.e2e.slackTokenState.query({ teamId: connectedTeamId }),
    ).toEqual({ token: connectedToken, live: true });
  });

  const exchanged: Record<string, string> = {};

  await test.step("once rotation is on, the sweep exchanges every token that does not expire", async () => {
    await api.e2e.slackEnableTokenRotation.mutate();
    await api.e2e.slackRenewTokens.mutate({ advanceSeconds: EXCHANGE_RETRY_S });

    for (const teamId of [helmTeamId, connectedTeamId]) {
      const state = await api.e2e.slackTokenState.query({ teamId });
      expect(state.live).toBe(true);
      expect(state.token).toMatch(/^xoxe\.xoxb-/);
      exchanged[teamId] = state.token!;
    }
  });

  await test.step("a token close to expiry is refreshed", async () => {
    await api.e2e.slackRenewTokens.mutate({
      advanceSeconds: 12 * HOUR_S - 15 * 60,
    });

    const state = await api.e2e.slackTokenState.query({
      teamId: connectedTeamId,
    });
    expect(state.live).toBe(true);
    expect(state.token).toMatch(/^xoxe\.xoxb-/);
    expect(state.token).not.toEqual(exchanged[connectedTeamId]);
  });

  await test.step("a token left to expire is refreshed on the next sweep", async () => {
    const before = await api.e2e.slackTokenState.query({
      teamId: helmTeamId,
    });
    await api.e2e.slackRenewTokens.mutate({ advanceSeconds: 13 * HOUR_S });

    const after = await api.e2e.slackTokenState.query({ teamId: helmTeamId });
    expect(after.live).toBe(true);
    expect(after.token).not.toEqual(before.token);
  });
});
