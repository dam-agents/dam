import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { BudgetMeter } from "../../budgets/components/budget-meter.js";
import { fetchSchedulesForAgent } from "../../schedules/api/queries.js";
import { AgentRow } from "../components/agent-row.js";
import { useAgentRows } from "../hooks/use-agent-rows.js";

export function ListView() {
  const { agentsData, initialLoaded, rowProps, deleteAgent, suspend } =
    useAgentRows();
  // Knowledge Bases are agents too, but they live on their own surface — the
  // Sandboxes list shows only unmarked agents.
  const agents = (agentsData?.list ?? []).filter(
    (agent) => agent.kind !== "knowledge-base",
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
    <div className="mx-auto w-full max-w-[666px]">
      <PageHeader
        title="Sandboxes"
        actions={
          agents.length > 0 ? (
            <Button onClick={navigateToCreateSandbox}>Create sandbox</Button>
          ) : undefined
        }
      />

      {initialLoaded && agents.length > 0 && <BudgetMeter />}

      {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

      {initialLoaded && agents.length === 0 && (
        <Card className="flex flex-col items-center gap-3 border border-border px-6 py-12 text-center anim-in">
          <h2 className="text-[16px] font-semibold text-foreground">
            No sandboxes yet
          </h2>
          <p className="text-[14px] text-muted-foreground">
            Create your first sandbox to get started.
          </p>
          <Button className="mt-1" onClick={navigateToCreateSandbox}>
            Create sandbox
          </Button>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {initialLoaded &&
          agents.map((agent) => (
            <AgentRow
              key={agent.id}
              {...rowProps(agent)}
              onSelect={() => navigateToSandboxHome(agent.id)}
              onStop={() => void stopSandbox(agent)}
              onDelete={() => void deleteSandbox(agent)}
            />
          ))}
      </div>
    </div>
  );
}
