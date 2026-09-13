// TEST_OVERVIEW: an agent's home lives on the disk of the node that ran it, and moving between nodes means fetching it over the peer link before the sandbox starts. Everything else about several nodes is checkable in isolation — placement picks a node, a certificate names one, a header parses — but the transfer is the only part where being wrong loses somebody's work rather than reporting an error, and it is the one part no unit test can reach: it takes two nodes, two disks and a real export. This walks the whole path — place, cordon, release, re-place, fetch — and asserts on a file the agent wrote before the move.
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

import {
  gotoAgentChat,
  sendMessageToAgent,
  setMockReplyWithFiles,
  waitForAgentRunning,
} from "../../lib/agents.js";
import { createApiClient, type ApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { agentName } from "../../lib/fixtures.js";

const markerPath = "work/cross-node-marker.txt";
const marker = `written-before-the-move-${Date.now()}`;

function cordon(nodeId: string, undo = false): void {
  execFileSync(
    "mise",
    ["run", "node:cordon", nodeId, ...(undo ? ["--undo"] : [])],
    { cwd: process.env.MISE_PROJECT_ROOT ?? process.cwd(), stdio: "inherit" },
  );
}

const nodeOf = async (
  api: ApiClient,
  agentId: string,
): Promise<string | null> =>
  (await api.e2e.placement.query({ agentId })).assignedNode;

test("an agent's workspace follows it to another node", async ({ page }) => {
  test.setTimeout(600_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  const baseUrl = process.env.PLATFORM_BASE_URL ?? "http://localhost:4000";

  const agentId = await waitForAgentRunning(api, agentName);
  const placement = await api.e2e.placement.query({ agentId });
  test.skip(
    placement.readyNodes.length < 2,
    "needs a second node — run: mise run e2e:second-node",
  );

  const from = placement.assignedNode;
  expect(from, "a running agent must be placed somewhere").toBeTruthy();

  await test.step("the agent writes a file into its workspace", async () => {
    await setMockReplyWithFiles(api, agentId, "marker written", [
      { path: markerPath, content: marker },
    ]);
    await page.goto(`${baseUrl}/coding-agents`);
    await gotoAgentChat(page, agentName, agentId);
    await sendMessageToAgent(page, "write the marker");
    await expect(page.getByText("marker written")).toBeVisible({
      timeout: 120_000,
    });
    // TEST_SCENARIO: read it back before moving anything, so a failure after the move is the move's fault and not the write's.
    expect(
      (await api.e2e.readWorkspaceFile.query({ agentId, path: markerPath }))
        .content,
    ).toBe(marker);
  });

  try {
    await test.step("cordoning the node it is on releases it", async () => {
      cordon(from!);
      await api.agents.stop.mutate({ id: agentId });
      await expect
        .poll(() => nodeOf(api, agentId), {
          timeout: 300_000,
          intervals: [3_000],
          message: "the scheduler never released the stopped agent",
        })
        .toBeNull();
    });

    await test.step("waking it places it on the other node", async () => {
      await api.agents.wake.mutate({ id: agentId });
      await expect
        .poll(() => nodeOf(api, agentId), {
          timeout: 300_000,
          intervals: [3_000],
          message: "the agent was never placed on the uncordoned node",
        })
        .not.toBe(from);
      await waitForAgentRunning(api, agentName);
    });

    // TEST_SCENARIO: the assertion the whole spec exists for. The agent is running on a node whose disk had nothing of its when the move began, so the file is here only if the export, the transfer and the swap-in all happened — and a fetch that quietly produced an empty home reads exactly like an agent that never had any files, which is why this is checked rather than the agent merely being up.
    await test.step("its workspace came with it", async () => {
      expect(
        (await api.e2e.readWorkspaceFile.query({ agentId, path: markerPath }))
          .content,
      ).toBe(marker);
    });
  } finally {
    cordon(from!, true);
  }
});
