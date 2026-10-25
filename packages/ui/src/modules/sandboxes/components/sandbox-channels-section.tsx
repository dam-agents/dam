import { EmptyState } from "@/components/ui/empty-state";

import { findAgent, useAgents } from "../../agents/api/queries.js";
import { OwnerOnlyNotice } from "../../agents/components/owner-only-notice.js";
import { holds, ownerName } from "../../agents/lib/agent-permissions.js";
import { SlackChannelCard } from "./channels/slack-channel-card.js";
import { TelegramChannelCard } from "./channels/telegram-channel-card.js";
import { WhisperCard } from "./channels/whisper-card.js";

export function SandboxChannelsSection({
  agentId,
  compact = false,
}: {
  agentId: string;
  compact?: boolean;
}) {
  const { data } = useAgents();
  const agent = findAgent(data, agentId) ?? undefined;
  const available = data?.availableChannels ?? {};
  const readOnly = agent ? !holds(agent.access, "channels") : false;

  // UNIT_BOUNDARY_DESCRIPTION: in a panel, a messenger this install does not offer shows nothing at all rather than a card telling the reader to ask an administrator, and whispers are a row of the Slack card rather than a card of their own.
  if (!available.slack && !available.telegram) {
    if (compact) return null;
    return (
      <EmptyState title="No messenger set up">
        There is nothing to connect yet. Ask your administrator to configure
        Slack or Telegram.
      </EmptyState>
    );
  }
  return (
    <>
      {agent && readOnly && (
        <OwnerOnlyNotice
          title="Only the owner connects channels."
          testId="channels-owner-only"
          className="mb-6"
        >
          Everyone in a connected channel can use this agent, and it runs with{" "}
          {ownerName(agent.access)}&apos;s connections there. Ask them to add or
          disconnect one.
        </OwnerOnlyNotice>
      )}
      {available.slack && !compact && agent && (
        <div className="mb-6">
          <WhisperCard agent={agent} />
        </div>
      )}
      {available.slack && (
        <SlackChannelCard
          agent={agent}
          withWhisper={compact}
          readOnly={readOnly}
        />
      )}
      {available.telegram && (
        <TelegramChannelCard agentId={agentId} readOnly={readOnly} />
      )}
    </>
  );
}
