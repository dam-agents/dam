import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { ComputeWidget } from "../../home/components/compute-widget.js";
import { SpendWidget } from "../../home/components/spend-widget.js";
import { SandboxList } from "../components/sandbox-list.js";
import { useAgentRows } from "../hooks/use-agent-rows.js";
import { useSandboxRowActions } from "../hooks/use-sandbox-row-actions.js";
import { splitTemporarySandboxes } from "../utils/temporary-sandboxes.js";

export function AgentsView() {
  const { agentsData, initialLoaded, rowProps, deleteAgent, suspend } =
    useAgentRows();
  const { visible, drawByDriver } = splitTemporarySandboxes(
    agentsData?.list ?? [],
  );
  const { stopSandbox, deleteSandbox } = useSandboxRowActions({
    deleteAgent,
    suspend,
  });

  const runningAgents = useMemo(
    () => visible.filter((a) => a.state === "running"),
    [visible],
  );
  const workingAgentIds = useMemo(
    () =>
      new Set(
        visible
          .filter((a) => a.state === "running" && a.size?.cpu)
          .map((a) => a.id),
      ),
    [visible],
  );

  const setView = useStore((s) => s.setView);
  const createAgent = () => setView("agent-new");

  return (
    <div>
      <PageHeader
        title="Home"
        actions={
          visible.length > 0 ? (
            <Button onClick={createAgent}>Create agent</Button>
          ) : undefined
        }
      />

      {initialLoaded && visible.length > 0 && (
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <ComputeWidget
            runningAgents={runningAgents}
            workingAgentIds={workingAgentIds}
          />
          <SpendWidget />
        </div>
      )}

      {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

      {initialLoaded && visible.length === 0 && (
        <PageEmptyState
          title="No agents yet"
          message="Each agent runs in its own isolated environment with your credentials and tools injected. Start from a pack or configure one from scratch."
          actionLabel="Create agent"
          onAction={createAgent}
        />
      )}

      {initialLoaded && (
        <SandboxList
          agents={visible}
          drawByDriver={drawByDriver}
          rowProps={rowProps}
          onStop={(agent) => void stopSandbox(agent)}
          onDelete={(agent) => void deleteSandbox(agent)}
        />
      )}
    </div>
  );
}
