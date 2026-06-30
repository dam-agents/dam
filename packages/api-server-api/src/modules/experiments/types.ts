/** Lifecycle of an Experiment. `draft` is the create-time default; start moves
 *  it to `running`; Stop moves it to `stopped`; it reaches `completed` on its
 *  own once every Arm is terminal (derived from Arm Status, written by the
 *  completion path — see {@link ArmStatus}). Only a `running` experiment has an
 *  active arm. */
export type ExperimentStatus = "draft" | "running" | "completed" | "stopped";

/** Per-Arm lifecycle, the source of truth for Experiment completion. `pending`
 *  (Arm added, Experiment not yet started) → `running` (Trial launched) → one
 *  terminal state: `completed` (`finish_arm` called), `failed` (Inactivity
 *  Deadline tripped, or the Trial failed to launch), or `stopped` (Experiment
 *  Stopped while the Arm was still running). The Experiment becomes `completed`
 *  once every Arm is terminal, regardless of the mix. */
export type ArmStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export interface Experiment {
  id: string;
  ownerId: string;
  name: string;
  /** The common instruction every arm receives; leads each arm's trial prompt. */
  prompt: string;
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
  armVariation: string;
  status: ArmStatus;
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

/** A list-row projection: the experiment plus the cheap rollup the list view
 *  needs — a swatch per arm and the total run count — without fetching every
 *  arm's full run ledger. `armAgentIds` is in arm-creation order; its length is
 *  the arm count. */
export interface ExperimentListItem extends Experiment {
  armAgentIds: string[];
  runCount: number;
}

/** What the ingestion / harness side needs to attribute work to the right
 *  experiment for a given agent, resolved from the agent's verified identity.
 *  Carries the prompt + arm variation so the harness has its task context in
 *  hand. */
export interface ActiveArm {
  experimentId: string;
  experimentName: string;
  prompt: string;
  agentId: string;
  armVariation: string;
}

export interface ExperimentCreateInput {
  name: string;
  prompt: string;
}

export interface ExperimentAddArmInput {
  experimentId: string;
  agentId: string;
  armVariation: string;
}

export interface ExperimentRecordRunInput {
  experimentId: string;
  agentId: string;
  sessionId: string;
  candidateRef: string;
  score: number;
}

/** Attribution for `finish_arm`, resolved from the caller's verified agent
 *  identity exactly like {@link ExperimentRecordRunInput} — the harness never
 *  supplies an experiment id. */
export interface ExperimentFinishArmInput {
  experimentId: string;
  agentId: string;
}

/** Owner-scoped application service. Composed per-owner for both the user tRPC
 *  router and the in-pod MCP session (the owner is bound at composition time,
 *  never taken from request input). */
export interface ExperimentsService {
  list(): Promise<ExperimentListItem[]>;
  getWithRuns(id: string): Promise<ExperimentWithRuns | null>;
  create(input: ExperimentCreateInput): Promise<Experiment>;
  /** Add an arm referencing an existing owned agent. */
  addArm(input: ExperimentAddArmInput): Promise<ExperimentArm>;
  start(id: string): Promise<Experiment>;
  stop(id: string): Promise<Experiment>;
  delete(id: string): Promise<void>;
  /** Resolve the arm of the owner's currently-running experiment that this
   *  agent belongs to, or null. Used by the ingestion path to attribute a run
   *  without trusting agent-supplied experiment ids. */
  resolveActiveArm(agentId: string): Promise<ActiveArm | null>;
  /** Append a Run to the ledger for an already attribution-resolved arm,
   *  allocating the next per-arm run number. The caller stores the Candidate
   *  artifact first; `candidateRef` is its key. Rejected (CONFLICT) once the
   *  calling arm is no longer `running` — the ledger can't grow after Stop or
   *  completion. */
  recordRun(input: ExperimentRecordRunInput): Promise<ExperimentRun>;
  /** Mark the calling arm `completed` — the success-only completion dual of
   *  `recordRun`. Advances the arm, then flips the Experiment to `completed`
   *  once every arm is terminal. Rejected (CONFLICT) unless the calling arm is
   *  `running`. */
  finishArm(input: ExperimentFinishArmInput): Promise<ExperimentArm>;
}
