import { EmptyState } from "@/components/ui/empty-state";

import { findAgent, useAgents } from "../../agents/api/queries.js";
import { OwnerOnlyNotice } from "../../agents/components/owner-only-notice.js";
import { holds, ownerName } from "../../agents/lib/agent-permissions.js";
import { useTelegramChats } from "../../telegram/api/queries.js";
import { findSlackChannels } from "../lib/slack-channels.js";
import { AgentModelPicker } from "./agent-model-picker.js";
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
  const telegramChats = useTelegramChats(
    available.telegram ? agentId : undefined,
  ).data?.chats.length;
  const slackChannels = findSlackChannels(agent);
  const hasChannel = slackChannels.length > 0 || (telegramChats ?? 0) > 0;

  const missing = [
    ...(available.slack ? [] : ["Slack"]),
    ...(available.telegram ? [] : ["Telegram"]),
  ];
  /* UNIT_BOUNDARY_DESCRIPTION: what channel turns run on is the agent's; before the first channel there is nothing to pick for, and runs follow the agent's own model. */
  const modelPicker = !compact && hasChannel && (
    <div className="mt-6">
      <AgentModelPicker agentId={agentId} kind="channel" />
    </div>
  );
  // UNIT_BOUNDARY_DESCRIPTION: in a panel the section names the messenger this install does not offer in one muted line, and shows no card for it; whispers are a row of the Slack card rather than a card of their own.
  if (missing.length === 2) {
    if (compact)
      return (
        <p className="text-sm text-muted-foreground">
          {notConfigured(missing)}
        </p>
      );
    return (
      <>
        <EmptyState title="No messenger set up">
          There is nothing to connect yet. Ask your administrator to configure
          Slack or Telegram.
        </EmptyState>
      </>
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
      {available.slack && (
        <SlackChannelCard
          agent={agent}
          withWhisper={compact && slackChannels.length > 0}
          readOnly={readOnly}
        />
      )}
      {/* UNIT_BOUNDARY_DESCRIPTION: whispers are a way into a Slack conversation, so the switch comes after the channels it applies to and only once there is one. */}
      {available.slack && !compact && agent && slackChannels.length > 0 && (
        <div className="mb-8">
          <WhisperCard agent={agent} />
        </div>
      )}
      {available.telegram && (
        <TelegramChannelCard
          agentId={agentId}
          readOnly={readOnly}
          compact={compact}
        />
      )}
      {compact && missing.length === 1 && (
        <p className="mt-4 text-sm text-muted-foreground">
          {notConfigured(missing)}
        </p>
      )}
      {modelPicker}
    </>
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the one line a panel says about a messenger the install does not offer, naming it and nothing else.
function notConfigured(missing: readonly string[]): string {
  return `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not configured on this install.`;
}
