import { ListSkeleton } from "../../../components/list-skeleton.js";
import { WelcomeEntryPoints } from "../../agents/components/welcome-entry-points.js";
import { useAgentRows } from "../../agents/hooks/use-agent-rows.js";
import { splitTemporarySandboxes } from "../../agents/utils/temporary-sandboxes.js";
import { SpendWidget } from "../../spend/components/spend-widget.js";
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
  const { agentsData, initialLoaded } = useAgentRows();
  const { visible } = splitTemporarySandboxes(agentsData?.list ?? []);

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
            <ResourcesBarsCard />
            <div className="md:col-span-2 [&>div]:h-full [&>div]:rounded-xl">
              <SpendWidget />
            </div>
            <ChannelsCard />
            <BusiestCard />
            <ActivityCard />
            <TipCard />
            <AgentStatesCard />
            <SchedulesCard />
            <HarnessCard />
            <ConnectionsCard />
            <ArtifactsCard />
            <ApiKeysCard />
            <SpendByKindCard />
            <ModelsCard />
            <TokensCard />
          </>
        )}
      </div>
    </div>
  );
}
