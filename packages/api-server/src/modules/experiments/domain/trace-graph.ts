import type {
  Experiment,
  ExperimentSpan,
  ScoreSeriesPoint,
  TraceFeed,
  TraceFeedInvocation,
  TraceFeedStage,
} from "api-server-api";

// The trace-graph resolver: pure projections from (skeleton, spans) to the
// shapes the live view renders. No IO, no clocks — everything derives from
// the inputs, so the whole lenient-skeleton semantics is unit-testable here.

/** Feed caps: the frame pushed into a dashboard must stay bounded no matter
 *  how many iterations a loop runs. */
export const RECENT_SPANS_MAX = 200;
export const SCORE_POINTS_MAX_PER_STAGE = 1000;

/** Stages surfaced by execution that the skeleton never declared, in
 *  first-seen order. `announced` carries stages from explicit stage-declare
 *  events (they precede their first span); span stages fill in the rest. */
export function discoverDrift(
  declaredStageIds: readonly string[],
  announced: readonly string[],
  spans: readonly Pick<ExperimentSpan, "stage">[],
): string[] {
  const known = new Set(declaredStageIds);
  const drift: string[] = [];
  for (const stage of [...announced, ...spans.map((s) => s.stage)]) {
    if (!known.has(stage)) {
      known.add(stage);
      drift.push(stage);
    }
  }
  return drift;
}

/** Even downsample preserving the first and last point, so a series' shape
 *  survives the cap instead of truncating its tail. */
export function downsample<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max) return [...points];
  if (max === 1) return [points[0]!];
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]!);
  }
  return out;
}

/** Project the bounded Trace Feed — the one contract shared by the stock and
 *  bespoke dashboards, the detail view, and the SDK docs. `spans` must be in
 *  chronological (startedAt ascending) order; the repository's read guarantees
 *  it. */
export function projectFeed(input: {
  experiment: Experiment;
  spans: readonly ExperimentSpan[];
  invocations: readonly TraceFeedInvocation[];
  custom?: Record<string, unknown> | null;
  /** Run-attached ids from outside the span flow (driver monitoring /
   *  invocation-target publishes) — unioned after the span rollup. */
  attachedArtifactIds?: readonly string[];
}): TraceFeed {
  const { experiment, spans, invocations } = input;

  const declaredIds = experiment.skeleton.stages.map((s) => s.id);
  const drift = discoverDrift(declaredIds, experiment.drift, spans);

  const byStage = new Map<string, ExperimentSpan[]>();
  for (const span of spans) {
    const bucket = byStage.get(span.stage);
    if (bucket) bucket.push(span);
    else byStage.set(span.stage, [span]);
  }

  const toStage = (id: string, declared: boolean): TraceFeedStage => {
    const stageSpans = byStage.get(id) ?? [];
    let lastScore: number | null = null;
    let bestScore: number | null = null;
    let running = 0;
    let failed = 0;
    for (const span of stageSpans) {
      if (span.status === "running") running++;
      if (span.status === "error") failed++;
      if (span.score !== null) {
        lastScore = span.score;
        bestScore =
          bestScore === null ? span.score : Math.max(bestScore, span.score);
      }
    }
    return {
      id,
      declared,
      spansTotal: stageSpans.length,
      spansRunning: running,
      spansFailed: failed,
      lastScore,
      bestScore,
    };
  };

  const stages = [
    ...declaredIds.map((id) => toStage(id, true)),
    ...drift.map((id) => toStage(id, false)),
  ];

  const scoreSeries = stages
    .map((stage) => {
      const points: ScoreSeriesPoint[] = (byStage.get(stage.id) ?? [])
        .filter((span) => span.score !== null)
        .map((span) => ({
          iteration: span.iteration,
          score: span.score!,
          spanId: span.spanId,
        }));
      return {
        stage: stage.id,
        points: downsample(points, SCORE_POINTS_MAX_PER_STAGE),
      };
    })
    .filter((series) => series.points.length > 0);

  const artifactIds: string[] = [];
  const seenArtifacts = new Set<string>();
  const spanArtifactIds = spans.flatMap((span) => span.artifactIds);
  for (const artifactId of [
    ...spanArtifactIds,
    ...(input.attachedArtifactIds ?? []),
  ]) {
    if (!seenArtifacts.has(artifactId)) {
      seenArtifacts.add(artifactId);
      artifactIds.push(artifactId);
    }
  }

  return {
    experiment: { ...experiment, drift },
    stages,
    scoreSeries,
    // Newest first: the drill-down shows the latest work without scrolling.
    recentSpans: spans.slice(-RECENT_SPANS_MAX).reverse(),
    invocations: [...invocations],
    artifactIds,
    custom: input.custom ?? null,
  };
}
