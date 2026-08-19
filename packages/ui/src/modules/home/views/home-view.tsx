import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { WelcomeEntryPoints } from "../../agents/components/welcome-entry-points.js";
import { useFeed } from "../api/queries.js";
import { FeedList } from "../components/feed-list.js";
import { HomeGreeting } from "../components/home-greeting.js";

export function HomeView() {
  const { items, runningAgents, hasAgents, loadingApprovals } = useFeed();
  const openAgentSession = useStore((s) => s.openAgentSession);

  if (!hasAgents) {
    return (
      <div>
        <HomeGreeting title="Welcome" />
        <WelcomeEntryPoints />
      </div>
    );
  }

  return (
    <div>
      <HomeGreeting title="Activity" />
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
        <section>
          {loadingApprovals && items.length === 0 ? (
            <ListSkeleton rows={3} rowHeight={116} />
          ) : items.length > 0 ? (
            <FeedList
              items={items}
              agents={runningAgents}
              onOpenSession={openAgentSession}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {runningAgents.length === 0
                ? "Nothing needs you. Unread and in-progress work show up here while a sandbox is running."
                : "Nothing needs you, and nothing is working right now."}
            </p>
          )}
        </section>
        <aside />
      </div>
    </div>
  );
}
