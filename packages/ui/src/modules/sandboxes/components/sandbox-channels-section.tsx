import { EmptyState } from "@/components/ui/empty-state";

import { useAgents } from "../../agents/api/queries.js";
import { SlackChannelCard } from "./channels/slack-channel-card.js";
import { TelegramChannelCard } from "./channels/telegram-channel-card.js";
import { WhisperCard } from "./channels/whisper-card.js";

export function SandboxChannelsSection({ agentId }: { agentId: string }) {
  const { data } = useAgents();
  const agent = data?.list.find((a) => a.id === agentId);
  const available = data?.availableChannels ?? {};

  if (!available.slack && !available.telegram)
    return (
      <EmptyState title="No messenger set up">
        There is nothing to connect yet. Ask your administrator to configure
        Slack or Telegram.
      </EmptyState>
    );
  return (
    <>
      {available.slack && agent && (
        <div className="mb-6">
          <WhisperCard agent={agent} />
        </div>
      )}
      {available.slack && <SlackChannelCard agent={agent} />}
      {available.telegram && <TelegramChannelCard agentId={agentId} />}
    </>
  );
}
