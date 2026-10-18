import { ListSkeleton } from "../../../components/list-skeleton.js";
import { SandboxList } from "../../agents/components/sandbox-list.js";
import { WelcomeEntryPoints } from "../../agents/components/welcome-entry-points.js";
import { useAgentRows } from "../../agents/hooks/use-agent-rows.js";
import { splitTemporarySandboxes } from "../../agents/utils/temporary-sandboxes.js";
import { SpendWidget } from "../../spend/components/spend-widget.js";
import { useFeed } from "../api/queries.js";
import { ApprovalsBanner } from "../components/approvals-banner.js";
import {
  ActivityCard,
  AgentStatesCard,
  ApiKeysCard,
  ArtifactsCard,
  BusiestCard,
  ChannelsCard,
  ConnectionsCard,
  HarnessCard,
  HeroCard,
  ModelsCard,
  ResourcesBarsCard,
  SchedulesCard,
  SpendByKindCard,
  TipCard,
  TokensCard,
} from "../components/home-cards.js";

export function HomeView() {
  const { agentsData, initialLoaded, rowProps } = useAgentRows();
  const { workingByAgent } = useFeed();
  const { visible, drawByDriver } = splitTemporarySandboxes(
    agentsData?.list ?? [],
  );

  if (!initialLoaded) return <ListSkeleton rows={4} rowHeight={140} />;

  return (
    <div className="flex flex-col gap-4">
      <ApprovalsBanner />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <HeroCard />
        {visible.length === 0 ? (
          <div className="col-span-full">
            <WelcomeEntryPoints />
          </div>
        ) : (
          <>
            <TipCard />
            <ResourcesBarsCard />
            <AgentStatesCard />
            <div className="md:col-span-2 [&>div]:h-full [&>div]:rounded-xl">
              <SpendWidget />
            </div>
            <ChannelsCard />
            <BusiestCard />
            <ActivityCard />
            <SchedulesCard />
            <HarnessCard />
            <ConnectionsCard />
            <ArtifactsCard />
            <ApiKeysCard />
            <SpendByKindCard />
            <ModelsCard />
            <TokensCard />
            <section
              aria-label="All agents"
              className="col-span-full flex flex-col rounded-xl border border-border bg-card p-5"
            >
              <h2 className="mb-4 text-sm text-muted-foreground">All agents</h2>
              <SandboxList
                agents={visible}
                drawByDriver={drawByDriver}
                rowProps={rowProps}
                workingByAgent={workingByAgent}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
