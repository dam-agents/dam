import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { useExperiments } from "../api/queries.js";
import { ExperimentRow } from "../components/experiment-row.js";

export function ExperimentsListView() {
  const { data } = useExperiments();
  const navigateToCreateExperiment = useStore(
    (s) => s.navigateToCreateExperiment,
  );
  const navigateToExperiment = useStore((s) => s.navigateToExperiment);

  const experiments = data ?? [];
  // Gate on data presence, not query success, so a transient refetch failure
  // keeps the cached list rendered instead of flashing skeletons over it.
  const initialLoaded = data !== undefined;

  return (
    <div>
      <div className="mb-8 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.5px] text-foreground">
            Experiments
          </h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Race configured arms against one goal and compare what they produce.
          </p>
        </div>
        {experiments.length > 0 && (
          <Button onClick={navigateToCreateExperiment}>New experiment</Button>
        )}
      </div>

      {!initialLoaded && <ListSkeleton rows={3} rowHeight={72} />}

      {initialLoaded && experiments.length === 0 && (
        <Card className="flex flex-col items-center gap-4 p-10 text-center">
          <p className="text-[14px] text-muted-foreground">
            No experiments yet. Create one to race arms against a goal.
          </p>
          <Button onClick={navigateToCreateExperiment}>New experiment</Button>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {experiments.map((experiment) => (
          <ExperimentRow
            key={experiment.id}
            experiment={experiment}
            onSelect={() => navigateToExperiment(experiment.id)}
          />
        ))}
      </div>
    </div>
  );
}
