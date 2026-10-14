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
      <p className="text-sm text-muted-foreground">
        No messenger is set up on this platform, so there is nothing to connect
        yet. Ask your operator to configure Slack or Telegram.
      </p>
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
