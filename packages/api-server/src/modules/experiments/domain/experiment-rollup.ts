import type {
  Experiment,
  ExperimentArm,
  ExperimentRun,
  ExperimentWithRuns,
} from "api-server-api";

/** Assemble the detail rollup: nest each arm's runs under it, keyed by agentId.
 *  Pure — the repository fetches arms and runs flat, this groups them. Runs
 *  whose agentId has no matching arm are dropped (a run can only belong to an
 *  arm; an orphan means a deleted arm and is not surfaced). */
export function rollupExperiment(
  experiment: Experiment,
  arms: ExperimentArm[],
  runs: ExperimentRun[],
): ExperimentWithRuns {
  const runsByAgent = new Map<string, ExperimentRun[]>();
  for (const run of runs) {
    const list = runsByAgent.get(run.agentId);
    if (list) list.push(run);
    else runsByAgent.set(run.agentId, [run]);
  }
  return {
    ...experiment,
    arms: arms.map((arm) => ({
      ...arm,
      runs: runsByAgent.get(arm.agentId) ?? [],
    })),
  };
}
