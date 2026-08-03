import type { z } from "zod";
import type { Agent } from "../agents/types.js";
import type {
  appendEventsRequestSchema,
  experimentSandboxCreateInputSchema,
  finishRequestSchema,
  planRegisterRequestSchema,
  skeletonSchema,
  traceEventSchema,
} from "./schemas.js";

export type ExperimentSandboxCreateInput = z.infer<
  typeof experimentSandboxCreateInputSchema
>;

/** Lifecycle of an Experiment — one execution of a driver's loop script.
 *  `draft` (plan registered, reviewable in the UI) → `running` (a started
 *  run launched the script) → exactly one terminal state: `completed`/`failed`
 *  (the script finished and said so, or the inactivity sweep reaped a silent
 *  run, or the launch itself failed) or `stopped` (user Stop; further events
 *  and tagged spawns are rejected, so the loop dies on its next call).
 *  Re-execution never reopens a terminal Experiment — it creates a sibling
 *  sharing the Script Artifact. */
export type ExperimentStatus =
  | "draft"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

/** A span starts `running` and ends `ok` or `error`; a span the script never
 *  closed simply stays `running` until its experiment goes terminal. */
export type SpanStatus = "running" | "ok" | "error";

export type Skeleton = z.infer<typeof skeletonSchema>;
export type TraceEvent = z.infer<typeof traceEventSchema>;
export type PlanRegisterInput = z.infer<typeof planRegisterRequestSchema>;
export type FinishInput = z.infer<typeof finishRequestSchema>;
export type AppendEventsInput = z.infer<typeof appendEventsRequestSchema>;

export interface Experiment {
  id: string;
  owner: string;
  driverAgentId: string;
  name: string;
  status: ExperimentStatus;
  skeleton: Skeleton;
  /** Stages discovered from execution that the skeleton never declared. */
  drift: string[];
  /** Pod-local path the launch prompt hands the harness (`python <path>`). */
  scriptPath: string;
  /** sha256 of the last captured script source. */
  scriptSha256: string;
  /** Artifact Library id of the versioned script source. */
  scriptArtifactId: string;
  /** Library version of the source this run executes (bumped when a
   *  run-start reports a changed sha). */
  scriptVersion: number;
  /** Dashboard rendered in the detail view; null = publish failed, the UI
   *  falls back to a native summary. */
  dashboardArtifactId: string | null;
  /** Failure reason for `failed` (launch error, inactivity, script error). */
  error: string | null;
  createdAt: string;
  executedAt: string | null;
  finishedAt: string | null;
  lastActivityAt: string | null;
}

export interface ExperimentSpan {
  spanId: string;
  stage: string;
  iteration: number | null;
  parentSpanId: string | null;
  status: SpanStatus;
  score: number | null;
  artifactIds: string[];
  attrs: Record<string, unknown> | null;
  startedAt: string;
  endedAt: string | null;
}

/** Per-stage rollup the graph view lights up. `declared` distinguishes
 *  skeleton stages from drift. */
export interface TraceFeedStage {
  id: string;
  declared: boolean;
  spansTotal: number;
  spansRunning: number;
  spansFailed: number;
  lastScore: number | null;
  bestScore: number | null;
}

export interface ScoreSeriesPoint {
  iteration: number | null;
  score: number;
  spanId: string;
}

/** An Invocation the driver spawned inside a span, summarized for the view. */
export interface TraceFeedInvocation {
  id: string;
  spanId: string | null;
  status: string;
}

/** The stable projection of Skeleton + Trace the platform serves — the one
 *  contract shared by the SDK docs, the stock and bespoke dashboards (via the
 *  postMessage bridge), and the detail view. Bounded: recentSpans and each
 *  stage's score series are capped server-side, so the frame never grows
 *  unbounded with iteration count. */
export interface TraceFeed {
  experiment: Experiment;
  stages: TraceFeedStage[];
  scoreSeries: { stage: string; points: ScoreSeriesPoint[] }[];
  recentSpans: ExperimentSpan[];
  invocations: TraceFeedInvocation[];
  /** Every Artifact Library id any span referenced plus run-attached ids
   *  (driver monitoring / invocation-target publishes), first-seen order —
   *  uncapped (unlike recentSpans) so the run-artifacts list is complete. */
  artifactIds: string[];
  /** The run's custom-data blob (`exp.post_data(...)` merges into it) —
   *  opaque to the platform, rendered by dashboards as they see fit. */
  custom: Record<string, unknown> | null;
}

/** Per-driver rollup behind the Experiments index. The destination regroups
 *  these into lineage rows (driver + name); clicking through lands in the
 *  agent's chat, where the live experiment panel docks. */
export interface ExperimentDriverSummary {
  driverAgentId: string;
  /** Newest first (createdAt), all statuses. */
  experiments: Pick<Experiment, "id" | "name" | "status" | "createdAt">[];
  /** The driver's `running` Invocations right now (loop fan-out at work). */
  runningInvocations: number;
}

/** Owner-scoped at composition (like every service on the tRPC context); the
 *  agent-facing methods additionally take the waypoint-verified driver id and
 *  attribute/reject on it — a driver can only ever touch its own experiments. */
export interface ExperimentsService {
  // Owner surface (tRPC).
  /** Create an experiment sandbox — an Agent marked `experiment`, set up with
   *  the authoring skill. Registers no Experiment: a draft only ever comes
   *  from the script's Plan Registration. Wired on the tRPC surface only. */
  createSandbox(input: ExperimentSandboxCreateInput): Promise<Agent>;
  list(): Promise<Experiment[]>;
  driverSummaries(): Promise<ExperimentDriverSummary[]>;
  get(id: string): Promise<Experiment | null>;
  feed(id: string): Promise<TraceFeed | null>;
  /** Start a run of this lineage. Building and running are separate: the
   *  draft is source and persists; a run is an immutable capture — a new
   *  experiment row with the draft's declaration plus its OWN script clone.
   *  While live it renders the draft's dashboard; the terminal snapshot
   *  mints the run's single-version results artifact. `id` may be the draft
   *  or any run of the lineage (the draft is resolved). Returns the new
   *  run. */
  startRun(id: string): Promise<Experiment>;
  stop(id: string): Promise<Experiment>;
  delete(id: string): Promise<void>;
  // Agent surface (REST on the harness port, mesh-attributed).
  planRegister(
    driverAgentId: string,
    input: PlanRegisterInput,
  ): Promise<{ experimentId: string }>;
  appendEvents(
    driverAgentId: string,
    experimentId: string,
    events: TraceEvent[],
  ): Promise<{ accepted: number }>;
  finish(
    driverAgentId: string,
    experimentId: string,
    input: FinishInput,
  ): Promise<void>;
  /** Attach a library artifact to a run outside the span flow. The driver
   *  (its monitoring harness) names the run explicitly; an invocation
   *  target omits `experimentId` and is auto-attributed through the
   *  invocation its own agent id keys. Returns where it landed, or null
   *  when the caller has no experiment linkage. */
  attachArtifact(
    callerAgentId: string,
    artifactId: string,
    experimentId?: string,
  ): Promise<{ experimentId: string } | null>;
}
