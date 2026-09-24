import { expect, test } from "@playwright/test";

import { ensureAgentExists, waitForAgentRunning } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { harnessName } from "../../lib/fixtures.js";

const agentName = "e2e-slack-permission";
const channel = "C-E2E-PERMISSION";
const strangerSlackUserId = "U-E2E-STRANGER";
const askedTs = "1700000950.000100";
const platformAskedTs = "1700000951.000100";
const spoofedAskedTs = "1700000952.000100";
const platformTool = "mcp__platform-outbound__send_channel_message";

test("harness permission prompts on a Slack turn: the platform's own tools are allowed, everything else refused (#3846, #4003)", async () => {
  test.setTimeout(360_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  await acceptTerms(api);
  await ensureAgentExists(api, agentName, harnessName);
  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("the channel binds to the agent", async () => {
    await api.agents.disconnectSlack.mutate({ id: agentId });
    await api.agents.connectSlack.mutate({
      id: agentId,
      slackChannelId: channel,
    });
  });

  async function askFor(
    tool: string,
    ts: string,
    displayTitle?: string,
  ): Promise<string> {
    await api.e2e.slackResetOutbound.mutate();
    await api.e2e.slackFireMention.mutate({
      user: strangerSlackUserId,
      channel,
      ts,
      text: `__ASK__ ${tool}${displayTitle ? ` ${displayTitle}` : ""}`,
    });

    let replyText = "";
    await expect
      .poll(
        async () => {
          const { records } = await api.e2e.slackReadOutbound.query();
          const reply = records.find(
            (r) =>
              r.kind === "message" &&
              r.channel === channel &&
              r.threadTs === ts &&
              r.text.includes("permission "),
          );
          replyText = reply && reply.kind === "message" ? reply.text : "";
          return replyText !== "";
        },
        {
          timeout: 180_000,
          intervals: [5_000],
          message: "the permission outcome never posted back to the thread",
        },
      )
      .toBe(true);
    return replyText;
  }

  await test.step("the agent asks before a tool call and is told no", async () => {
    const replyText = await askFor("write_notion_page", askedTs);
    expect(replyText).toContain("reject-once");
    expect(replyText).not.toContain("allow-once");
    expect(replyText).not.toContain("unanswered");
  });

  await test.step("a prompt for the platform's own tools is answered yes", async () => {
    const replyText = await askFor(platformTool, platformAskedTs);
    expect(replyText).toContain("allow-once");
    expect(replyText).not.toContain("reject-once");
    expect(replyText).not.toContain("unanswered");
  });

  await test.step("a shell call wearing a platform tool's display title is refused", async () => {
    const replyText = await askFor("Bash", spoofedAskedTs, platformTool);
    expect(replyText).toContain("reject-once");
    expect(replyText).not.toContain("allow-once");
    expect(replyText).not.toContain("unanswered");
  });
});
