import { expect, test } from "@playwright/test";

import { baseUrl } from "../config.js";
import {
  agentCardStatus,
  agentNameHeading,
  sendMessageToAgent,
  setMockAgentReply,
  waitForAgentRunning,
} from "../lib/agents.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";

const harnessName = "mock";
const agentName = "e2e-lifecycle";
const scriptedReply = "scripted-reply-from-lifecycle";
const userPrompt = "hello-from-lifecycle";
// Imported via the real create-flow bundle (not mock-written) — proves the import landed.
const importedFile = "imported-context.md";
const importedContent = "imported via the e2e create-flow bundle";

// Issue #168 / ADR-058: a create-time import gates "running" until it lands + contributions settle. Real pipeline, no reload; sleeping-lock is out of scope.
// Failure paths (fatal reject / give-up → importError badge) and mid-transfer pod-roll
// recovery (503 → client re-POST) are verified by cluster/manual test: deterministically
// injecting them needs an import failure-injection hook (or a lowered import cap) the mock
// harness lacks, and faking them would assert the mock's logic, not the platform's.
test("agent is not openable until import lands + contributions settle, then chats", async ({
  page,
}) => {
  const token = await getAccessToken();
  const api = createApiClient(token);

  await test.step("assert clean slate", async () => {
    const existing = (await api.agents.list.query()).find(
      (a) => a.name === agentName,
    );
    expect(
      existing,
      `agent ${agentName} already exists - expected clean slate`,
    ).toBeUndefined();
  });

  await test.step("open app", async () => {
    await page.goto(baseUrl);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
  });

  await test.step("create mock agent with a real file import", async () => {
    await page.getByRole("button", { name: /add agent/i }).click();
    await page.getByText(harnessName, { exact: true }).click();

    await page.getByPlaceholder("my-agent").fill(agentName);

    // The plain (non-directory) hidden file input; the create flow uploads it via the import-proxy.
    await page
      .locator('input[type="file"]:not([webkitdirectory])')
      .setInputFiles({
        name: importedFile,
        mimeType: "text/markdown",
        buffer: Buffer.from(importedContent),
      });

    await page.getByRole("button", { name: /create agent/i }).click();
  });

  await test.step("agent is not openable while starting", async () => {
    // Appears in the list on its own, no reload.
    await expect(agentNameHeading(page, agentName)).toBeVisible({
      timeout: 30_000,
    });
    await expect(agentCardStatus(page, agentName, "Starting")).toBeVisible();

    // Clicking a starting agent is a no-op: it must not reach the detail view.
    await agentNameHeading(page, agentName).click();
    await expect(page).not.toHaveURL(/\/chat\//);
  });

  await test.step("agent becomes openable once running, without reload", async () => {
    // Reaching "Running" proves the import landed and the built-in contribution settled (applyState).
    await expect(agentCardStatus(page, agentName, "Running")).toBeVisible({
      timeout: 180_000,
    });
  });

  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("settled cleanly — no degraded contributions, no import error", async () => {
    const agent = await api.agents.get.query({ id: agentId });
    expect(
      agent.contributionFailures,
      `agent settled with failures: ${JSON.stringify(agent.contributionFailures)}`,
    ).toEqual([]);
    // A successful import clears the marker → no importError badge; proves the
    // success path doesn't false-badge (the inverse of the fatal/give-up path).
    expect(
      agent.importError,
      `import marked failed after a clean import: ${agent.importError}`,
    ).toBeFalsy();
  });

  await test.step("open agent; imported file is present in the tree", async () => {
    await agentNameHeading(page, agentName).click();
    await expect(page).toHaveURL(
      new RegExp(`/chat/${encodeURIComponent(agentId)}`),
    );

    // Imported files land under <homeDir>/work, same as the harness working dir.
    await page.getByRole("button", { name: "files", exact: true }).click();
    await page.getByText("work", { exact: true }).click();
    await expect(page.getByText(importedFile, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step("interactivity: a chat round-trip works", async () => {
    await setMockAgentReply(api, agentId, scriptedReply);
    await sendMessageToAgent(page, userPrompt);
    await expect(page.getByText(scriptedReply)).toBeVisible({
      timeout: 30_000,
    });
  });

  // No teardown: leave the agent in place.
});
