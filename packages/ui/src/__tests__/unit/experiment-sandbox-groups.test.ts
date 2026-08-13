import type { ExperimentDriverSummary } from "api-server-api";
import { describe, expect, test } from "vitest";

import { isExperimentSandbox } from "../../modules/agents/utils/agent-kind.js";
import { toSandboxGroups } from "../../modules/experiments/lib/sandbox-groups.js";
import type { AgentView } from "../../types.js";

const agent = (id: string, kind?: AgentView["kind"]): AgentView => ({
  id,
  name: id,
  templateId: null,
  templateUpdate: null,
  kbTemplateId: null,
  image: "x:latest",
  hibernationTimeoutMin: 60,
  grantedSecretIds: [],
  grantedConnectionIds: [],
  stopRequested: false,
  overBudget: false,
  size: {},
  state: "running",
  contributionFailures: [],
  channels: [],
  spawnedBy: null,
  ...(kind ? { kind } : {}),
});

const summary = (
  driverAgentId: string,
  experiments: ExperimentDriverSummary["experiments"],
  runningInvocations = 0,
): ExperimentDriverSummary => ({
  driverAgentId,
  experiments,
  runningInvocations,
});

const experiment = (
  id: string,
  name: string,
  status: "draft" | "running" | "completed",
  createdAt = "2026-07-01T00:00:00Z",
) =>
  ({
    id,
    name,
    status,
    createdAt,
  }) as ExperimentDriverSummary["experiments"][number];

describe("toSandboxGroups", () => {
  test("lists a marked sandbox with no experiments as an empty container", () => {
    const groups = toSandboxGroups(
      [],
      [agent("marked", "experiment")],
      isExperimentSandbox,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ agentId: "marked", lineages: [] });
  });

  test("lists an unmarked agent that registered a plan — the marker is intent, not a gate", () => {
    const groups = toSandboxGroups(
      [summary("plain", [experiment("e1", "evolver", "completed")])],
      [agent("plain")],
      isExperimentSandbox,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.agentId).toBe("plain");
    expect(groups[0]?.lineages).toHaveLength(1);
  });

  test("does not duplicate a marked sandbox that also has experiments", () => {
    const groups = toSandboxGroups(
      [summary("marked", [experiment("e1", "evolver", "running")])],
      [agent("marked", "experiment")],
      isExperimentSandbox,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.agentId).toBe("marked");
    expect(groups[0]?.lineages).toHaveLength(1);
  });

  test("collects every deleted sandbox's experiments into one trailing group", () => {
    const groups = toSandboxGroups(
      [
        summary("gone-1", [experiment("e1", "evolver", "completed")]),
        summary("gone-2", [experiment("e2", "tuner", "completed")]),
      ],
      [],
      isExperimentSandbox,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      agentId: "__deleted__",
      agent: null,
      name: "Deleted sandboxes",
    });
    expect(groups[0]?.lineages).toHaveLength(2);
  });

  test("excludes plain sandboxes that never registered a plan", () => {
    const groups = toSandboxGroups([], [agent("plain")], isExperimentSandbox);
    expect(groups).toHaveLength(0);
  });

  test("rolls a lineage's runs up under one row per name", () => {
    const groups = toSandboxGroups(
      [
        summary(
          "a",
          [
            experiment("e3", "evolver", "running", "2026-07-03T00:00:00Z"),
            experiment("e2", "evolver", "completed", "2026-07-02T00:00:00Z"),
            experiment("e1", "evolver", "draft", "2026-07-01T00:00:00Z"),
          ],
          4,
        ),
      ],
      [agent("a", "experiment")],
      isExperimentSandbox,
    );
    const lineage = groups[0]?.lineages[0];
    expect(lineage).toMatchObject({
      name: "evolver",
      runCount: 2,
      liveCount: 1,
      badge: "running",
      runningInvocations: 4,
    });
    // Deleting the lineage removes the draft too, not just the runs.
    expect(lineage?.experimentIds).toEqual(["e3", "e2", "e1"]);
  });

  test("rolls the group badge up from the experiments, not the agent lifecycle", () => {
    const [live] = toSandboxGroups(
      [
        summary("a", [
          experiment("e1", "x", "running", "2026-07-01T00:00:00Z"),
          experiment("e2", "y", "completed", "2026-07-02T00:00:00Z"),
        ]),
      ],
      [agent("a", "experiment")],
      isExperimentSandbox,
    );
    // Live wins even though the completed lineage is newer.
    expect(live?.rollup).toBe("running");

    const [done] = toSandboxGroups(
      [summary("b", [experiment("e3", "z", "completed")])],
      [agent("b", "experiment")],
      isExperimentSandbox,
    );
    expect(done?.rollup).toBe("completed");

    const [empty] = toSandboxGroups(
      [],
      [agent("c", "experiment")],
      isExperimentSandbox,
    );
    expect(empty?.rollup).toBeNull();
  });

  test("orders live sandboxes first, empty ones after busy, deleted last", () => {
    const groups = toSandboxGroups(
      [
        summary("busy", [
          experiment("e1", "x", "completed", "2026-07-02T00:00:00Z"),
        ]),
        summary("live", [
          experiment("e2", "y", "running", "2026-07-01T00:00:00Z"),
        ]),
        summary("gone", [
          experiment("e3", "z", "completed", "2026-07-03T00:00:00Z"),
        ]),
      ],
      [
        agent("busy"),
        agent("live", "experiment"),
        agent("empty", "experiment"),
      ],
      isExperimentSandbox,
    );
    expect(groups.map((g) => g.agentId)).toEqual([
      "live",
      "busy",
      "empty",
      "__deleted__",
    ]);
  });
});
