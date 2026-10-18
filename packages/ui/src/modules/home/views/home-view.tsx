import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useAgents } from "../../agents/api/queries.js";
import { WelcomeEntryPoints } from "../../agents/components/welcome-entry-points.js";
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
  const { data: agentsData } = useAgents();
  const initialLoaded = agentsData !== undefined;
  const { visible } = splitTemporarySandboxes(agentsData?.list ?? []);

  if (!initialLoaded) return <ListSkeleton rows={4} rowHeight={140} />;

  return (
    <div className="@container flex flex-col gap-4">
      <ApprovalsBanner />
      <div className="grid grid-flow-row-dense grid-cols-1 gap-4 @xl:grid-cols-2 @5xl:grid-cols-4">
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
            <div className="@xl:col-span-2 [&>div]:h-full [&>div]:rounded-xl">
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
          </>
        )}
      </div>
    </div>
  );
}
