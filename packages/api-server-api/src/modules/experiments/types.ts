/** Opaque JSON config the platform stores but does not interpret. The
 *  experiment `spec` (shared task + budget) and per-arm `armSpec` are both
 *  user-authored blobs handed to the harness at start; only the harness reads
 *  them (epic decision D4). */
export type ExperimentConfig = Record<string, unknown>;

/** Lifecycle of an Experiment. `draft` is the create-time default; the start
 *  path (later ticket) moves it to `running`; stop/finish move it to `stopped`
 *  / `completed`. Only a `running` experiment has an active arm. */
export type ExperimentStatus = "draft" | "running" | "completed" | "stopped";

export interface Experiment {
  id: string;
  ownerId: string;
  name: string;
  /** Prose statement of what every arm is racing toward. */
  goal: string;
  spec: ExperimentConfig;
  status: ExperimentStatus;
  createdAt: string;
  updatedAt: string;
}

/** One competitor: an existing Agent (the harness image) plus its config.
 *  Keyed `(experimentId, agentId)` — the same agent cannot be two arms of one
 *  experiment, but the same harness image can back many agents (same-framework
 *  racing happens at the agent level). */
export interface ExperimentArm {
  experimentId: string;
  agentId: string;
  armSpec: ExperimentConfig;
  createdAt: string;
}

/** One ledger entry an arm's harness loop emits. `score` is opaque jsonb (the
 *  platform does not rank or normalize it) and `candidateRef` points at a
 *  stored Candidate artifact; both are populated by the ingestion path in a
 *  later ticket. */
export interface ExperimentRun {
  id: string;
  experimentId: string;
  agentId: string;
  runNumber: number;
  sessionId: string;
  candidateRef: string | null;
  score: unknown;
  status: string;
  startedAt: string;
  endedAt: string | null;
}

export interface ExperimentArmWithRuns extends ExperimentArm {
  runs: ExperimentRun[];
}

/** The detail rollup: an experiment with its arms, each arm carrying its own
 *  run ledger. Comparison in the MVP is per-arm only. */
export interface ExperimentWithRuns extends Experiment {
  arms: ExperimentArmWithRuns[];
}

/** What the ingestion / harness side needs to attribute work to the right
 *  experiment for a given agent, resolved from the agent's verified identity.
 *  Carries the goal + specs so the harness has its task context in hand. */
export interface ActiveArm {
  experimentId: string;
  experimentName: string;
  goal: string;
  spec: ExperimentConfig;
  agentId: string;
  armSpec: ExperimentConfig;
}

export interface ExperimentCreateInput {
  name: string;
  goal: string;
  spec: ExperimentConfig;
}

export interface ExperimentAddArmInput {
  experimentId: string;
  agentId: string;
  armSpec: ExperimentConfig;
}

export interface ExperimentRecordRunInput {
  experimentId: string;
  agentId: string;
  sessionId: string;
  candidateRef: string;
  score: number;
}

/** Owner-scoped application service. Composed per-owner for both the user tRPC
 *  router and the in-pod MCP session (the owner is bound at composition time,
 *  never taken from request input). */
export interface ExperimentsService {
  list(): Promise<Experiment[]>;
  getWithRuns(id: string): Promise<ExperimentWithRuns | null>;
  create(input: ExperimentCreateInput): Promise<Experiment>;
  /** Add an arm referencing an existing owned agent. */
  addArm(input: ExperimentAddArmInput): Promise<ExperimentArm>;
  delete(id: string): Promise<void>;
  /** Resolve the arm of the owner's currently-running experiment that this
   *  agent belongs to, or null. Used by the ingestion path to attribute a run
   *  without trusting agent-supplied experiment ids. */
  resolveActiveArm(agentId: string): Promise<ActiveArm | null>;
  /** Append a Run to the ledger for an already attribution-resolved arm,
   *  allocating the next per-arm run number. The caller stores the Candidate
   *  artifact first; `candidateRef` is its key. */
  recordRun(input: ExperimentRecordRunInput): Promise<ExperimentRun>;
}
