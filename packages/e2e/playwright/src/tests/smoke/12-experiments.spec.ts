import { expect, test } from "@playwright/test";

import { baseUrl } from "../../config.js";
import {
  chatInput,
  gotoAgentDetail,
  sendMessageToAgent,
  setMockAgentReply,
  setMockReplyWithFiles,
  waitForAgentRunning,
} from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { agentName } from "../../lib/fixtures.js";

// The whole experiments rail (#2942), driven with the REAL python SDK inside
// the mock pod: the spec seeds a loop script via the mock's control channel,
// a __PYRUN__ prompt runs it in plan mode (registering the draft over the
// harness surface), the experiment panel docks itself in the chat with a
// "Start a new run" button that launches via the runtime channel (the mock
// recognizes the composed launch prompt and backgrounds the script exactly
// like a real harness), and the loop streams spans to completion. The
// Experiments destination is a lineage index that routes back into the chat.

const experimentName = "e2e-loop";
const scriptPath = "exp.py";
// The mock's out-of-the-box reply; 07/08/10-slack rely on it verbatim. This
// spec overwrites it via setMockReplyWithFiles below, so it must restore it
// before the shared agent moves on to those specs.
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
    await page.goto(baseUrl);
    await gotoAgentDetail(page, agentName, agentId);
    await sendMessageToAgent(page, `__PYRUN__ ${scriptPath}`);
    // The mock writes exp.py, runs `python3 exp.py` (plan mode: the SDK
    // registers the draft and exits 0), and echoes the run's output.
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
    // The chat is still open from the plan step; the panel self-docks once
    // the ambient list poll picks the draft up. The header shows the name
    // with a nested "(draft)" suffix, so match the title attribute rather
    // than exact text; the Start button is the step's real precondition.
    await expect(page.getByTitle(experimentName)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Start a new run" }).click();

    // Building and running are separate: the draft persists and the run is
    // a fresh experiment row cloned from it.
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
    // The run freezes its own script clone; while live it renders the
    // draft's dashboard (its results artifact is created at the end).
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
    expect(feed.recentSpans.length).toBe(6); // 3 iterations × 2 stages
    const evalStage = feed.stages.find((s) => s.id === "eval");
    expect(evalStage?.bestScore).toBe(1);
    expect(feed.scoreSeries.map((s) => s.stage)).toEqual(["eval"]);

    // The run's panel (opened via its launch session) rides it to terminal.
    await expect(
      page.getByText("completed", { exact: true }).first(),
    ).toBeVisible({ timeout: 30_000 });

    // The terminal snapshot minted the run's own single-version results
    // artifact — self-contained, with the final feed baked in.
    const draft = await api.experiments.get.query({ id: experimentId });
    await expect
      .poll(
        async () =>
          (await api.experiments.get.query({ id: runId })).dashboardArtifactId,
        { timeout: 30_000 },
      )
      .not.toBe(draft.dashboardArtifactId);
  });

  await test.step("the Experiments destination indexes the agent and routes to chat", async () => {
    await page.goto(`${baseUrl}/experiments`);
    const row = page.getByRole("button", { name: new RegExp(agentName) });
    await expect(row).toBeVisible();
    await expect(
      page.getByText(experimentName, { exact: false }),
    ).toBeVisible();
    await row.click();
    // Landing in the agent's chat — the experiment panel is reachable there.
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
