import type { useExperiment, useExperiments } from "./api/queries.js";

export type { ArmStatus, ExperimentStatus } from "api-server-api";

// Derive view types from the query hooks rather than the hand-written contract
// interfaces: tRPC's output inference turns `unknown` fields (a run's opaque
// `score`) optional, so the inferred shape is what components actually receive.

/** A row in the experiments list — the experiment plus arm swatches + run
 *  count. */
export type ExperimentListEntry = NonNullable<
  ReturnType<typeof useExperiments>["data"]
>[number];

/** A single experiment with its arms and their run ledgers. */
export type ExperimentDetail = NonNullable<
  ReturnType<typeof useExperiment>["data"]
>;

/** One arm of {@link ExperimentDetail}, carrying its run ledger. */
export type ExperimentArmDetail = ExperimentDetail["arms"][number];
