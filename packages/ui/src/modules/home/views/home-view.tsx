import { ListSkeleton } from "../../../components/list-skeleton.js";
import { EntryPointButtons } from "../../agents/components/entry-point-buttons.js";
import { OutdatedTemplatesBanner } from "../../agents/components/outdated-templates-banner.js";
import { SandboxList } from "../../agents/components/sandbox-list.js";
import { WelcomeEntryPoints } from "../../agents/components/welcome-entry-points.js";
import { useAgentRows } from "../../agents/hooks/use-agent-rows.js";
import { useSandboxRowActions } from "../../agents/hooks/use-sandbox-row-actions.js";
import { splitTemporarySandboxes } from "../../agents/utils/temporary-sandboxes.js";
import { ComputeUsage } from "../../budgets/components/compute-usage.js";
import { useFeed } from "../api/queries.js";
import { ApprovalsBanner } from "../components/approvals-banner.js";
import { HomeGreeting } from "../components/home-greeting.js";
import { WidgetSkeleton } from "../components/home-skeletons.js";
import { SpendWidget } from "../components/spend-widget.js";

export function HomeView() {
  const { agentsData, initialLoaded, rowProps, deleteAgent, suspend } =
    useAgentRows();
  const { workingAgentIds, workingByAgent } = useFeed();
  const { stopSandbox, deleteSandbox } = useSandboxRowActions({
    deleteAgent,
    suspend,
  });

  const { visible, drawByDriver } = splitTemporarySandboxes(
    agentsData?.list ?? [],
  );

  if (!initialLoaded) {
    return (
      <div>
        <HomeGreeting title="Agents" />
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <WidgetSkeleton rows={2} />
          <WidgetSkeleton rows={2} />
        </div>
        <ListSkeleton rows={3} rowHeight={70} />
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div>
        <HomeGreeting title="Welcome" />
        <WelcomeEntryPoints />
      </div>
    );
  }

  return (
    <div>
      <HomeGreeting
        title="Agents"
        actions={<EntryPointButtons surface="home" primary="agent" />}
      />
      <OutdatedTemplatesBanner agents={visible} />
      <ApprovalsBanner />
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6">
          <ComputeUsage
            agents={agentsData?.list ?? []}
            workingAgentIds={workingAgentIds}
          />
        </div>
        <SpendWidget />
      </div>
      <SandboxList
        agents={visible}
        drawByDriver={drawByDriver}
        rowProps={rowProps}
        workingByAgent={workingByAgent}
        onStop={(agent) => void stopSandbox(agent)}
        onDelete={(agent) => void deleteSandbox(agent)}
      />
    </div>
  );
}
