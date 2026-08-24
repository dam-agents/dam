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

export type ExperimentStatus =
  | "draft"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

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
  drift: string[];
  scriptPath: string;
  scriptSha256: string;
  scriptArtifactId: string;
  scriptVersion: number;
  dashboardArtifactId: string | null;
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

export interface TraceFeedStage {
  id: string;
  declared: boolean;
  spansTotal: number;
  spansRunning: number;
  spansFailed: number;
  lastScore: number | null;
  bestScore: number | null;
  totalDurationMs: number | null;
  avgDurationMs: number | null;
  lastDurationMs: number | null;
}

export interface ScoreSeriesPoint {
  iteration: number | null;
  score: number;
  spanId: string;
}

export interface TraceFeedInvocation {
  id: string;
  spanId: string | null;
  status: string;
}

export interface TraceFeed {
  experiment: Experiment;
  stages: TraceFeedStage[];
  scoreSeries: { stage: string; points: ScoreSeriesPoint[] }[];
  recentSpans: ExperimentSpan[];
  invocations: TraceFeedInvocation[];
  artifactIds: string[];
  custom: Record<string, unknown> | null;
}

export interface ExperimentDriverSummary {
  driverAgentId: string;
  experiments: Pick<Experiment, "id" | "name" | "status" | "createdAt">[];
  runningInvocations: number;
}

export interface ExperimentsService {
  createSandbox(input: ExperimentSandboxCreateInput): Promise<Agent>;
  list(): Promise<Experiment[]>;
  driverSummaries(): Promise<ExperimentDriverSummary[]>;
  get(id: string): Promise<Experiment | null>;
  feed(id: string): Promise<TraceFeed | null>;
  startRun(id: string): Promise<Experiment>;
  stop(id: string): Promise<Experiment>;
  delete(id: string): Promise<void>;
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
  attachArtifact(
    callerAgentId: string,
    artifactId: string,
    experimentId?: string,
  ): Promise<{ experimentId: string } | null>;
}
