import { EmptyState } from "@/components/ui/empty-state";

import { getBrand } from "../../../brand.js";
import { findAgent, useAgents } from "../../agents/api/queries.js";
import { OwnerOnlyNotice } from "../../agents/components/owner-only-notice.js";
import { holds, ownerName } from "../../agents/lib/agent-permissions.js";
import {
  canAddChannel,
  showsAssistantChannelsNotice,
} from "../lib/channels-binding.js";
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
  const canAdd = agent ? canAddChannel(agent.access, agent.kind) : true;
  const bindingBlocked = showsAssistantChannelsNotice(agent?.kind);
  const assistantName = getBrand().assistantName;

  const missing = [
    ...(available.slack ? [] : ["Slack"]),
    ...(available.telegram ? [] : ["Telegram"]),
  ];
  /* UNIT_BOUNDARY_DESCRIPTION: what channel turns run on is the agent's, whatever messengers this install offers, so the page picks it below an install with none. */
  const modelPicker = !compact && (
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
        {modelPicker}
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
      {/* UNIT_BOUNDARY_DESCRIPTION: only binding is refused on the assistant, so the section says why and shows no Connect control while whispers stay. */}
      {bindingBlocked && (
        <p
          className="mb-6 text-sm text-muted-foreground"
          data-testid="channels-binding-unavailable"
        >
          {assistantName} is yours alone, so it cannot be added to a Slack or
          Telegram conversation. Make another agent if you want one that people
          can talk to from a channel. A conversation it was added to before can
          still be released below.
        </p>
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
          canAdd={canAdd}
        />
      )}
      {available.telegram && (
        <TelegramChannelCard
          agentId={agentId}
          readOnly={readOnly}
          canAdd={canAdd}
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
