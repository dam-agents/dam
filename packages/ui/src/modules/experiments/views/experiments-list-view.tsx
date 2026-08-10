import { useState } from "react";

import { Button } from "@/components/ui/button";
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

export function ExperimentsListView() {
  const { data: summaries } = useDriverSummaries();
  const { data: agentsData } = useAgents();
  const navigateToCreateSandbox = useStore((s) => s.navigateToCreateSandbox);
  const selectAgent = useStore((s) => s.selectAgent);
  const setView = useStore((s) => s.setView);
  const deleteExperiment = useDeleteExperiment();
  const [deleteTarget, setDeleteTarget] = useState<LineageRow | null>(null);

  const groups = toSandboxGroups(
    summaries ?? [],
    agentsData?.list ?? [],
    isExperimentSandbox,
  );
  const initialLoaded = summaries !== undefined && agentsData !== undefined;

  return (
    <div>
      {initialLoaded && groups.length > 0 && (
        <PageHeader
          title="Experiments"
          description="Experiments are grouped by the sandbox running them. Open a sandbox to work with it in chat, where the experiment graph docks beside the conversation."
          actions={
            <Button onClick={() => navigateToCreateSandbox("experiment")}>
              Create experiment
            </Button>
          }
        />
      )}

      {!initialLoaded && <ListSkeleton rows={3} rowHeight={72} />}

      {initialLoaded && groups.length === 0 && (
        <ExperimentsEmptyState
          onCreate={() => navigateToCreateSandbox("experiment")}
        />
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
        <p className="mt-6 text-[14px] text-muted-foreground">
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
        title={`Delete experiment "${deleteTarget?.name}"?`}
        description="The draft and all its runs are removed. Artifacts already published to the library (scripts, results) are kept."
        confirmLabel="Delete"
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (!target) return;
          void (async () => {
            for (const id of target.experimentIds) {
              await deleteExperiment.mutateAsync({ id }).catch(() => {});
            }
          })();
        }}
      />
    </div>
  );
}

function ExperimentsEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-border py-16 text-center anim-in">
      <h2 className="text-[20px] font-semibold text-foreground">Experiments</h2>
      <p className="mt-2 max-w-[480px] text-[14px] leading-relaxed text-muted-foreground">
        An experiment runs one goal across several variants at once and charts
        each result live, so you can compare approaches side-by-side.
      </p>
      <Button className="mt-6" onClick={onCreate}>
        Create experiment
      </Button>
    </div>
  );
}
