import { Button } from "@/components/ui/button";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { BudgetMeter } from "../../budgets/components/budget-meter.js";
import { fetchSchedulesForAgent } from "../../schedules/api/queries.js";
import { AgentRow } from "../components/agent-row.js";
import { useAgentRows } from "../hooks/use-agent-rows.js";
import { splitTemporarySandboxes } from "../utils/temporary-sandboxes.js";

export function ListView() {
  const { agentsData, initialLoaded, rowProps, deleteAgent, suspend } =
    useAgentRows();
  // Every agent the user created, badged with its Kind: the per-kind
  // destinations are filtered views onto this list. Invocation targets are the
  // one exception — run-owned and ephemeral, they hide behind a meta line on
  // the driver's own row that accounts for their compute.
  const { visible: agents, drawByDriver } = splitTemporarySandboxes(
    agentsData?.list ?? [],
  );

  const navigateToCreateSandbox = useStore((s) => s.navigateToCreateSandbox);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const showConfirm = useStore((s) => s.showConfirm);

  const stopSandbox = async (agent: AgentView) => {
    // Schedules override a stop by design (#1900) — say so before it lands.
    const schedules = await fetchSchedulesForAgent(agent.id);
    const scheduleNote =
      schedules.length > 0 ? (
        <>
          {" "}
          This sandbox has <strong>{schedules.length} schedule(s)</strong> — the
          next fire will start it again.
        </>
      ) : null;
    const msg = (
      <>
        Stop sandbox <strong className="text-foreground">"{agent.name}"</strong>
        ? It stays stopped until you start it.{scheduleNote}
      </>
    );
    if (!(await showConfirm(msg, "Stop Sandbox"))) return;
    suspend.stop(agent.id);
  };

  const deleteSandbox = async (agent: AgentView) => {
    const msg = (
      <>
        Delete sandbox{" "}
        <strong className="text-foreground">"{agent.name}"</strong>? This will
        also delete <strong>all persistent data</strong> and cannot be undone.
      </>
    );
    if (!(await showConfirm(msg, "Delete Sandbox", { kind: "destructive" })))
      return;
    deleteAgent.mutate({ id: agent.id });
  };

  return (
    <div>
      <PageHeader
        title="Sandboxes"
        actions={
          agents.length > 0 ? (
            <Button onClick={() => navigateToCreateSandbox()}>
              Create sandbox
            </Button>
          ) : undefined
        }
      />

      {initialLoaded && agents.length > 0 && <BudgetMeter />}

      {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

      {initialLoaded && agents.length === 0 && (
        <PageEmptyState
          title="No sandboxes yet"
          message="Create your first sandbox to get started."
          actionLabel="Create sandbox"
          // Wrapped: navigateToCreateSandbox takes an optional starting point,
          // and a bare handler would receive the click event as one.
          onAction={() => navigateToCreateSandbox()}
        />
      )}

      <div className="flex flex-col gap-3">
        {initialLoaded &&
          agents.map((agent) => (
            <AgentRow
              key={agent.id}
              {...rowProps(agent)}
              temporaryDraw={drawByDriver.get(agent.id)}
              onSelect={() => navigateToSandboxHome(agent.id)}
              onStop={() => void stopSandbox(agent)}
              onDelete={() => void deleteSandbox(agent)}
            />
          ))}
      </div>
    </div>
  );
}
