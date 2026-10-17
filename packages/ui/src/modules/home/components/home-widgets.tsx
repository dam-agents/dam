import { cn } from "@/lib/utils";

import { useAgents } from "../../agents/api/queries.js";
import { WelcomeEntryPoints } from "../../agents/components/welcome-entry-points.js";
import { splitTemporarySandboxes } from "../../agents/utils/temporary-sandboxes.js";
import { ResourcesCard } from "../../budgets/components/resources-card.js";
import { SpendWidget } from "../../spend/components/spend-widget.js";
import { useFeed } from "../api/queries.js";
import { ApprovalsBanner } from "./approvals-banner.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The part of Home that the sidebar does not
 * show. Home and the sidebar are one pane: on Home the pane fills the screen
 * and these widgets fold open above the Agents list; on any other page the
 * pane narrows to the sidebar and they fold shut.
 */
export function HomeWidgets({ open }: { open: boolean }) {
  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden px-2">
        <div className="pb-8">{open && <Widgets />}</div>
      </div>
    </div>
  );
}

function Widgets() {
  const { data } = useAgents();
  const { workingAgentIds } = useFeed();
  const allAgents = data?.list ?? [];
  if (data && splitTemporarySandboxes(allAgents).visible.length === 0)
    return <WelcomeEntryPoints />;
  return (
    <>
      <ApprovalsBanner />
      <div className="@container">
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
          <div className="rounded-lg border border-border bg-background p-6">
            <ResourcesCard
              agents={allAgents}
              workingAgentIds={workingAgentIds}
            />
          </div>
          <SpendWidget />
        </div>
      </div>
    </>
  );
}
