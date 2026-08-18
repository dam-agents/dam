import { Renew } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { BudgetMeter } from "../../budgets/components/budget-meter.js";
import { SandboxList } from "../components/sandbox-list.js";
import { WelcomeEntryPoints } from "../components/welcome-entry-points.js";
import { useAgentRows } from "../hooks/use-agent-rows.js";
import { useSandboxRowActions } from "../hooks/use-sandbox-row-actions.js";
import { splitTemporarySandboxes } from "../utils/temporary-sandboxes.js";

export function ListView() {
  const { agentsData, initialLoaded, rowProps, deleteAgent, suspend, update } =
    useAgentRows();
  const { visible: agents, drawByDriver } = splitTemporarySandboxes(
    agentsData?.list ?? [],
  );
  const { stopSandbox, deleteSandbox } = useSandboxRowActions({
    deleteAgent,
    suspend,
  });

  const outdated = agents.filter((a) => a.templateUpdate);
  const showUpdateAllBanner = outdated.length > 1;

  const setView = useStore((s) => s.setView);

  return (
    <div>
      <PageHeader
        title="Home"
        actions={
          agents.length > 0 ? (
            <Button onClick={() => setView("coding-agent-new")}>
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

      {initialLoaded && (
        <SandboxList
          agents={agents}
          drawByDriver={drawByDriver}
          rowProps={rowProps}
          onStop={(agent) => void stopSandbox(agent)}
          onDelete={(agent) => void deleteSandbox(agent)}
        />
      )}
    </div>
  );
}
