import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { useAgents } from "../../agents/api/queries.js";
import { OutdatedTemplatesBanner } from "../../agents/components/outdated-templates-banner.js";
import { isExperimentSandbox } from "../../agents/utils/agent-kind.js";
import { useDeleteExperiment } from "../api/mutations.js";
import { useDriverSummaries } from "../api/queries.js";
import { SandboxGroupCard } from "../components/sandbox-group-card.js";
import { type LineageRow, toSandboxGroups } from "../lib/sandbox-groups.js";

export function ExperimentsListView() {
  const { data: summaries } = useDriverSummaries();
  const { data: agentsData } = useAgents();
  const selectAgent = useStore((s) => s.selectAgent);
  const setView = useStore((s) => s.setView);
  const deleteExperiment = useDeleteExperiment();
  const [deleteTarget, setDeleteTarget] = useState<LineageRow | null>(null);

  const groups = toSandboxGroups(
    summaries ?? [],
    agentsData?.list ?? [],
    isExperimentSandbox,
  );
  const experimentSandboxes = (agentsData?.list ?? []).filter(
    isExperimentSandbox,
  );
  const initialLoaded = summaries !== undefined && agentsData !== undefined;
  const createExperimentSandbox = () => setView("agent-new");

  return (
    <div>
      <PageHeader
        title="Experiments"
        description={
          groups.length > 0
            ? "Experiments are grouped by the agent running them. Open an agent to work with it in chat, where the experiment graph docks beside the conversation."
            : undefined
        }
        actions={
          groups.length > 0 ? (
            <Button onClick={createExperimentSandbox}>Create experiment</Button>
          ) : undefined
        }
      />

      {!initialLoaded && <ListSkeleton rows={3} rowHeight={72} />}

      {initialLoaded && (
        <OutdatedTemplatesBanner agents={experimentSandboxes} />
      )}

      {initialLoaded && groups.length === 0 && (
        <PageEmptyState
          title="No experiments yet"
          message="An experiment runs one goal across several variants at once and charts each result live, so you can compare them. Create an experiment agent and it will help you design the first one."
          actionLabel="Create experiment"
          onAction={createExperimentSandbox}
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
        <p className="mt-6 text-sm text-muted-foreground">
          Deleting an agent doesn&apos;t delete its experiments — the runs and
          their published results stay in the{" "}
          <Button
            variant="link"
            size="inline"
            onClick={() => setView("artifacts")}
            className="text-accent"
          >
            artifact library
          </Button>
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
            for (const id of target.experimentIds) {
              await deleteExperiment.mutateAsync({ id }).catch(() => {});
            }
          })();
        }}
      />
    </div>
  );
}
