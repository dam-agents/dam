import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { useAgents } from "../../agents/api/queries.js";
import { SlackChannelCard } from "./channels/slack-channel-card.js";
import { TelegramChannelCard } from "./channels/telegram-channel-card.js";

export function SandboxChannelsSection({ agentId }: { agentId: string }) {
  const { data } = useAgents();
  const agent = data?.list.find((a) => a.id === agentId);
  const available = data?.availableChannels ?? {};

  return (
    <section className="mb-8">
      <SectionLabel spaced>Channels</SectionLabel>
      <p className="-mt-1 mb-4 text-sm text-muted-foreground">
        Connect this agent to messenger surfaces (Slack channels, Telegram
        chats).
      </p>
      {!available.slack && !available.telegram ? (
        <p className="text-sm text-muted-foreground">
          No messenger is set up on this platform, so there is nothing to
          connect yet. Ask your operator to configure Slack or Telegram.
        </p>
      ) : (
        <Inset className="flex flex-col gap-4">
          {available.slack && <SlackChannelCard agent={agent} />}
          {available.telegram && <TelegramChannelCard agentId={agentId} />}
        </Inset>
      )}
    </section>
  );
}
