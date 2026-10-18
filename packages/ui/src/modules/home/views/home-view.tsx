import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { EntryPointButtons } from "../../agents/components/entry-point-buttons.js";
import { SandboxList } from "../../agents/components/sandbox-list.js";
import { WelcomeEntryPoints } from "../../agents/components/welcome-entry-points.js";
import { useAgentRows } from "../../agents/hooks/use-agent-rows.js";
import { splitTemporarySandboxes } from "../../agents/utils/temporary-sandboxes.js";
import { ResourcesCard } from "../../budgets/components/resources-card.js";
import { useNewLayout } from "../../features/hooks/use-new-layout.js";
import { SpendWidget } from "../../spend/components/spend-widget.js";
import { useFeed } from "../api/queries.js";
import { ApprovalsBanner } from "../components/approvals-banner.js";
import { WidgetSkeleton } from "../components/home-skeletons.js";
import { DashboardHomeView } from "./dashboard-home-view.js";

export function HomeView() {
  if (useNewLayout()) return <DashboardHomeView />;
  return <CurrentHomeView />;
}

function CurrentHomeView() {
  const { agentsData, initialLoaded, rowProps } = useAgentRows();
  const { workingAgentIds, workingByAgent } = useFeed();

  const allAgents = agentsData?.list ?? [];
  const { visible, drawByDriver } = splitTemporarySandboxes(allAgents);

  if (!initialLoaded) {
    return (
      <div>
        <PageHeader title="Home" />
        <div className="@container mb-8">
          <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
            <WidgetSkeleton rows={2} />
            <WidgetSkeleton rows={2} />
          </div>
        </div>
        <ListSkeleton rows={3} rowHeight={70} />
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div>
        <PageHeader title="Home" />
        <WelcomeEntryPoints />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Home" />
      <ApprovalsBanner />
      <div className="@container mb-8">
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-6">
            <ResourcesCard
              agents={allAgents}
              workingAgentIds={workingAgentIds}
            />
          </div>
          <SpendWidget />
        </div>
      </div>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <EntryPointButtons />
      </div>
      <SandboxList
        agents={visible}
        drawByDriver={drawByDriver}
        rowProps={rowProps}
        workingByAgent={workingByAgent}
      />
    </div>
  );
}
