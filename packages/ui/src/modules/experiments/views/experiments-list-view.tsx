import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { useAgents } from "../../agents/api/queries.js";
import { isExperimentSandbox } from "../../agents/utils/agent-kind.js";
import { useDeleteExperiment } from "../api/mutations.js";
import { useDriverSummaries } from "../api/queries.js";
import { SandboxGroupCard } from "../components/sandbox-group-card.js";
import { type LineageRow, toSandboxGroups } from "../lib/sandbox-groups.js";

/** The sandboxes that run experiments, each holding its named loops. Opening
 *  anything here lands in the sandbox chat, where the live panel docks. */
export function ExperimentsListView() {
  const { data: summaries } = useDriverSummaries();
  const { data: agentsData } = useAgents();
  const selectAgent = useStore((s) => s.selectAgent);
  const navigateToCreateSandbox = useStore((s) => s.navigateToCreateSandbox);
  const setView = useStore((s) => s.setView);
  const deleteExperiment = useDeleteExperiment();
  const [deleteTarget, setDeleteTarget] = useState<LineageRow | null>(null);

  const groups = toSandboxGroups(
    summaries ?? [],
    agentsData?.list ?? [],
    isExperimentSandbox,
  );
  // Gate on data presence, not query success, so a transient refetch failure
  // keeps the cached list rendered instead of flashing skeletons over it.
  const initialLoaded = summaries !== undefined && agentsData !== undefined;
  const createExperimentSandbox = () => navigateToCreateSandbox("experiment");

  return (
    <div>
      <PageHeader
        title="Experiments"
        description="Experiments are grouped by the sandbox running them. Open a sandbox to work with it in chat, where the experiment graph docks beside the conversation."
        actions={
          groups.length > 0 ? (
            <Button onClick={createExperimentSandbox}>Create experiment</Button>
          ) : undefined
        }
      />

      {!initialLoaded && <ListSkeleton rows={3} rowHeight={72} />}

      {initialLoaded && groups.length === 0 && (
        <Card className="flex flex-col items-center gap-3 border border-border px-6 py-12 text-center anim-in">
          <h2 className="text-[16px] font-semibold text-foreground">
            No experiments yet
          </h2>
          <p className="text-[14px] text-muted-foreground">
            An experiment runs one goal across several variants at once and
            charts each result live, so you can compare them. Create an
            experiment sandbox and its agent will help you design the first one.
          </p>
          <Button className="mt-1" onClick={createExperimentSandbox}>
            Create experiment
          </Button>
        </Card>
      )}

      <div className="flex flex-col gap-9">
        {initialLoaded &&
          groups.map((group) => (
            <SandboxGroupCard
              key={group.agentId}
              group={group}
              onOpenSandbox={selectAgent}
              onDeleteLineage={setDeleteTarget}
            />
          ))}
      </div>

      {initialLoaded && groups.length > 0 && (
        <p className="mt-6 text-[13px] text-muted-foreground">
          Deleting a sandbox doesn&apos;t delete its experiments — the runs and
          their published results stay in the{" "}
          <button
            type="button"
            onClick={() => setView("artifacts")}
            className="text-accent hover:underline"
          >
            artifact library
          </button>
          .
        </p>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        kind="destructive"
        title={`Delete experiment “${deleteTarget?.name}”?`}
        description="The draft and all its runs are removed. Artifacts already published to the library (scripts, results) are kept."
        confirmLabel="Delete"
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (!target) return;
          void (async () => {
            // Sequential: each id is one row; failures toast individually
            // and the rest still go.
            for (const id of target.experimentIds) {
              await deleteExperiment.mutateAsync({ id }).catch(() => {});
            }
          })();
        }}
      />
    </div>
  );
}
