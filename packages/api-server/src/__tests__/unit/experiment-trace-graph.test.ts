import { describe, it, expect } from "vitest";
import type { Experiment, ExperimentSpan } from "api-server-api";
import {
  discoverDrift,
  downsample,
  projectFeed,
  RECENT_SPANS_MAX,
  SCORE_POINTS_MAX_PER_STAGE,
} from "../../modules/experiments/domain/trace-graph.js";

function experiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: "exp-1",
    owner: "user-1",
    driverAgentId: "driver-1",
    name: "prompt-evolver",
    status: "running",
    skeleton: {
      stages: [
        { id: "produce", after: [] },
        { id: "eval", after: ["produce"] },
        { id: "select", after: ["eval"] },
      ],
      loops: [{ id: "generations", stages: ["produce", "eval", "select"] }],
    },
    drift: [],
    scriptPath: "/home/agent/work/exp.py",
    scriptSha256: "a".repeat(64),
    scriptArtifactId: "art-script",
    scriptVersion: 1,
    dashboardArtifactId: "art-dash",
    error: null,
    createdAt: "2026-07-23T10:00:00Z",
    executedAt: "2026-07-23T10:05:00Z",
    finishedAt: null,
    lastActivityAt: "2026-07-23T10:10:00Z",
    ...overrides,
  };
}

let spanCounter = 0;
function span(overrides: Partial<ExperimentSpan> = {}): ExperimentSpan {
  spanCounter++;
  return {
    spanId: `s-${spanCounter}`,
    stage: "produce",
    iteration: 0,
    parentSpanId: null,
    status: "ok",
    score: null,
    artifactIds: [],
    attrs: null,
    startedAt: `2026-07-23T10:${String(10 + (spanCounter % 45)).padStart(2, "0")}:00Z`,
    endedAt: null,
    ...overrides,
  };
}

describe("discoverDrift", () => {
  it("returns undeclared stages in first-seen order, announced first", () => {
    expect(
      discoverDrift(
        ["produce", "eval"],
        ["mutate"],
        [{ stage: "eval" }, { stage: "crossover" }, { stage: "mutate" }],
      ),
    ).toEqual(["mutate", "crossover"]);
  });

  it("is empty when execution matches the skeleton", () => {
    expect(
      discoverDrift(["a", "b"], [], [{ stage: "a" }, { stage: "b" }]),
    ).toEqual([]);
  });

  it("deduplicates repeated drift stages", () => {
    expect(
      discoverDrift([], [], [{ stage: "x" }, { stage: "x" }, { stage: "x" }]),
    ).toEqual(["x"]);
  });
});

describe("downsample", () => {
  it("passes short series through untouched", () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it("keeps first and last and the target length", () => {
    const series = Array.from({ length: 100 }, (_, i) => i);
    const out = downsample(series, 10);
    expect(out).toHaveLength(10);
    expect(out[0]).toBe(0);
    expect(out[9]).toBe(99);
  });
});

describe("projectFeed", () => {
  it("orders stages skeleton-first then drift, flagged as such", () => {
    const feed = projectFeed({
      experiment: experiment(),
      spans: [span({ stage: "eval" }), span({ stage: "mutate" })],
      invocations: [],
    });
    expect(feed.stages.map((s) => [s.id, s.declared])).toEqual([
      ["produce", true],
      ["eval", true],
      ["select", true],
      ["mutate", false],
    ]);
    expect(feed.experiment.drift).toEqual(["mutate"]);
  });

  it("aggregates per-stage counts and scores", () => {
    const feed = projectFeed({
      experiment: experiment(),
      spans: [
        span({ stage: "eval", score: 0.4 }),
        span({ stage: "eval", score: 0.9 }),
        span({ stage: "eval", score: 0.7 }),
        span({ stage: "eval", status: "error" }),
        span({ stage: "eval", status: "running" }),
      ],
      invocations: [],
    });
    const evalStage = feed.stages.find((s) => s.id === "eval")!;
    expect(evalStage.spansTotal).toBe(5);
    expect(evalStage.spansRunning).toBe(1);
    expect(evalStage.spansFailed).toBe(1);
    expect(evalStage.lastScore).toBe(0.7);
    expect(evalStage.bestScore).toBe(0.9);
  });

  it("emits score series only for stages that scored, capped", () => {
    const many = Array.from(
      { length: SCORE_POINTS_MAX_PER_STAGE + 500 },
      (_, i) => span({ stage: "eval", iteration: i, score: i / 1000 }),
    );
    const feed = projectFeed({
      experiment: experiment(),
      spans: [span({ stage: "produce" }), ...many],
      invocations: [],
    });
    expect(feed.scoreSeries.map((s) => s.stage)).toEqual(["eval"]);
    const points = feed.scoreSeries[0]!.points;
    expect(points).toHaveLength(SCORE_POINTS_MAX_PER_STAGE);
    expect(points[0]!.iteration).toBe(0);
    expect(points.at(-1)!.iteration).toBe(SCORE_POINTS_MAX_PER_STAGE + 499);
  });

  it("unions run-attached artifact ids after the span rollup, deduped", () => {
    const feed = projectFeed({
      experiment: experiment(),
      spans: [
        span({ stage: "eval", artifactIds: ["art-a", "art-b"] }),
        span({ stage: "eval", artifactIds: ["art-a"] }),
      ],
      invocations: [],
      attachedArtifactIds: ["art-b", "art-monitor-report"],
    });
    expect(feed.artifactIds).toEqual(["art-a", "art-b", "art-monitor-report"]);
  });

  it("caps recentSpans to the newest, newest-first", () => {
    const many = Array.from({ length: RECENT_SPANS_MAX + 50 }, (_, i) =>
      span({ spanId: `n-${i}` }),
    );
    const feed = projectFeed({
      experiment: experiment(),
      spans: many,
      invocations: [],
    });
    expect(feed.recentSpans).toHaveLength(RECENT_SPANS_MAX);
    expect(feed.recentSpans[0]!.spanId).toBe(`n-${RECENT_SPANS_MAX + 49}`);
  });

  it("handles the empty-skeleton pure-trace experiment", () => {
    const feed = projectFeed({
      experiment: experiment({ skeleton: { stages: [], loops: [] } }),
      spans: [span({ stage: "work", score: 1 })],
      invocations: [{ id: "inv-1", spanId: "s-1", status: "running" }],
    });
    expect(feed.stages.map((s) => [s.id, s.declared])).toEqual([
      ["work", false],
    ]);
    expect(feed.invocations).toEqual([
      { id: "inv-1", spanId: "s-1", status: "running" },
    ]);
  });

  it("renders a draft (zero spans) as the bare declared skeleton", () => {
    const feed = projectFeed({
      experiment: experiment({ status: "draft" }),
      spans: [],
      invocations: [],
    });
    expect(feed.stages).toHaveLength(3);
    expect(feed.stages.every((s) => s.spansTotal === 0 && s.declared)).toBe(
      true,
    );
    expect(feed.scoreSeries).toEqual([]);
    expect(feed.recentSpans).toEqual([]);
  });
});
