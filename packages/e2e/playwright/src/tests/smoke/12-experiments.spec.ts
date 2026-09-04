import { expect, test } from "@playwright/test";

import { baseUrl } from "../../config.js";
import {
  chatInput,
  gotoAgentChat,
  sendMessageToAgent,
  setMockAgentReply,
  setMockReplyWithFiles,
  waitForAgentRunning,
} from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { agentName } from "../../lib/fixtures.js";

const experimentName = "e2e-loop";
const scriptPath = "exp.py";
const mockDefaultReply = "Hello from the mock agent.";

const experimentScript = `import experiment_sdk as x

with x.Experiment(${JSON.stringify(experimentName)}) as exp:
    loop = exp.loop("generations")
    produce = loop.stage("produce")
    evaluate = loop.stage("eval", after=produce)
    for gen in exp.iterations(loop, max_iterations=3):
        with produce.run():
            pass
        with evaluate.run() as span:
            span.score = gen * 0.5
`;

test("experiment: plan, execute, watch it run to completion", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("register the plan by running the script in-pod", async () => {
    await setMockReplyWithFiles(api, agentId, "script written", [
      { path: scriptPath, content: experimentScript },
    ]);
    await page.goto(`${baseUrl}/coding-agents`);
    await gotoAgentChat(page, agentName, agentId);
    await sendMessageToAgent(page, `__PYRUN__ ${scriptPath}`);
    await expect(page.getByText(/\[pyrun exit 0\]/)).toBeVisible({
      timeout: 120_000,
    });
  });

  let experimentId = "";
  await test.step("the draft appears with its skeleton", async () => {
    await expect
      .poll(
        async () => {
          const experiments = await api.experiments.list.query();
          const draft = experiments.find((e) => e.name === experimentName);
          experimentId = draft?.id ?? "";
          return draft?.status;
        },
        { timeout: 30_000 },
      )
      .toBe("draft");

    const experiment = await api.experiments.get.query({ id: experimentId });
    expect(experiment.skeleton.stages.map((s) => s.id)).toEqual([
      "produce",
      "eval",
    ]);
    expect(experiment.scriptVersion).toBe(1);
  });

  let runId = "";
  await test.step("the draft docks its panel; start a run from there", async () => {
    await expect(page.getByTitle(experimentName, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Start a new run" }).click();

    await expect
      .poll(
        async () => {
          const experiments = await api.experiments.list.query();
          const run = experiments.find(
            (e) => e.name === experimentName && e.status !== "draft",
          );
          runId = run?.id ?? "";
          return run?.status;
        },
        { timeout: 30_000 },
      )
      .toBe("running");
    const draft = await api.experiments.get.query({ id: experimentId });
    expect(draft.status).toBe("draft");
    const run = await api.experiments.get.query({ id: runId });
    expect(run.scriptArtifactId).not.toBe(draft.scriptArtifactId);
    expect(run.dashboardArtifactId).toBe(draft.dashboardArtifactId);
  });

  await test.step("the loop streams spans and completes", async () => {
    await expect
      .poll(
        async () => (await api.experiments.get.query({ id: runId })).status,
        { timeout: 120_000 },
      )
      .toBe("completed");

    const feed = await api.experiments.feed.query({ id: runId });
    expect(feed.recentSpans.length).toBe(6);
    const evalStage = feed.stages.find((s) => s.id === "eval");
    expect(evalStage?.bestScore).toBe(1);
    expect(feed.scoreSeries.map((s) => s.stage)).toEqual(["eval"]);

    await expect(
      page.getByText("completed", { exact: true }).first(),
    ).toBeVisible({ timeout: 30_000 });

    const draft = await api.experiments.get.query({ id: experimentId });
    await expect
      .poll(
        async () =>
          (await api.experiments.get.query({ id: runId })).dashboardArtifactId,
        { timeout: 30_000 },
      )
      .not.toBe(draft.dashboardArtifactId);
  });

  await test.step("the retired destination lands on Home, and chat stays reachable", async () => {
    await page.goto(`${baseUrl}/experiments`);
    await expect(page).toHaveURL(`${baseUrl}/`);
    await page.goto(`${baseUrl}/chat/${encodeURIComponent(agentId)}`);
    await expect(chatInput(page)).toBeVisible({ timeout: 30_000 });
  });

  await test.step("the script landed versioned in the artifact library", async () => {
    const artifacts = await api.artifactLibrary.list.query();
    const script = artifacts.find((a) =>
      a.title.startsWith(`${experimentName} —`),
    );
    expect(script).toBeTruthy();
  });

  await test.step("restore the mock's default reply for the specs that follow", async () => {
    await setMockAgentReply(api, agentId, mockDefaultReply);
  });
});
