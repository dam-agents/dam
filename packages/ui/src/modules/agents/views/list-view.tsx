import { Renew } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { BudgetMeter } from "../../budgets/components/budget-meter.js";
import { fetchSchedulesForAgent } from "../../schedules/api/queries.js";
import { AgentRow } from "../components/agent-row.js";
import { WelcomeEntryPoints } from "../components/welcome-entry-points.js";
import { useAgentRows } from "../hooks/use-agent-rows.js";
import { isKnowledgeBase } from "../utils/agent-kind.js";
import { splitTemporarySandboxes } from "../utils/temporary-sandboxes.js";

export function ListView() {
  const { agentsData, initialLoaded, rowProps, deleteAgent, suspend, update } =
    useAgentRows();
  const { visible: agents, drawByDriver } = splitTemporarySandboxes(
    agentsData?.list ?? [],
  );

  const outdated = agents.filter((a) => a.templateUpdate);
  const showUpdateAllBanner = outdated.length > 1;

  const navigateToCreateSandbox = useStore((s) => s.navigateToCreateSandbox);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const selectAgent = useStore((s) => s.selectAgent);
  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);
  const showConfirm = useStore((s) => s.showConfirm);

  const stopSandbox = async (agent: AgentView) => {
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
        title="Home"
        actions={
          agents.length > 0 ? (
            <Button onClick={() => navigateToCreateSandbox()}>
              Create sandbox
            </Button>
          ) : undefined
        }
      />

      {initialLoaded && agents.length > 0 && (
        <>
          <BudgetMeter />
          <SectionLabel spaced>Sandboxes</SectionLabel>
        </>
      )}

      {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

      {initialLoaded && agents.length === 0 && <WelcomeEntryPoints />}

      {initialLoaded && showUpdateAllBanner && (
        <Callout
          tone="info"
          size="sm"
          className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5"
        >
          <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <Renew size={16} className="shrink-0 text-accent" />
            <span>
              <strong className="font-medium text-foreground">
                {outdated.length} sandboxes
              </strong>{" "}
              out of date — newer images available upstream.
            </span>
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={update.updatingAll || update.updatingId !== null}
            className="shrink-0 font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
            onClick={() => void update.updateAll(outdated)}
          >
            <Renew size={16} />
            {update.updatingAll ? "Updating…" : "Update all"}
          </Button>
        </Callout>
      )}

      <div className="flex flex-col gap-3">
        {initialLoaded &&
          agents.map((agent) => {
            const kb = isKnowledgeBase(agent);
            return (
              <AgentRow
                key={agent.id}
                {...rowProps(agent)}
                temporaryDraw={drawByDriver.get(agent.id)}
                onSelect={() =>
                  kb ? openKnowledgeBase(agent.id) : selectAgent(agent.id)
                }
                onConfigure={() => navigateToSandboxHome(agent.id)}
                configureLabel="Configure sandbox"
                onStop={() => void stopSandbox(agent)}
                onDelete={() => void deleteSandbox(agent)}
              />
            );
          })}
      </div>
    </div>
  );
}
