import { useState } from "react";

import { getBrand } from "../../../brand.js";
import { useSetSlackAmbient } from "../../agents/api/mutations.js";
import { useAgents } from "../../agents/api/queries.js";
import { BindSuccessPage } from "../../agents/components/bind/bind-success-page.js";
import { CommandChip } from "../../agents/components/bind/command-chip.js";
import { ChannelSwitchCard } from "../../sandboxes/components/channels/channel-switch-card.js";
import { WhisperCard } from "../../sandboxes/components/channels/whisper-card.js";
import { isSlackDirectMessageId } from "../../sandboxes/lib/shared-channels.js";

interface Props {
  agentId: string;
  agentName: string;
  slackChannelId: string;
  channelTitle: string | null;
}

export function SlackBindSuccess({
  agentId,
  agentName,
  slackChannelId,
  channelTitle,
}: Props) {
  const brand = getBrand();
  const saveAmbient = useSetSlackAmbient();
  const [ambient, setAmbient] = useState(false);
  const agent = useAgents().data?.list.find((a) => a.id === agentId);

  const handleAmbientChange = (next: boolean) => {
    const previous = ambient;
    setAmbient(next);
    saveAmbient.mutate(
      { id: agentId, slackChannelId, ...(next ? { ambient: true } : {}) },
      { onError: () => setAmbient(previous) },
    );
  };

  const channel = channelTitle ? `#${channelTitle}` : "this channel";

  return (
    <BindSuccessPage
      messenger="slack"
      title={`${agentName} has been added to ${channel}`}
    >
      <p>
        Mention <CommandChip>@{brand.name}</CommandChip> in the channel to use
        it. If the channel has more than one agent, add the name:{" "}
        <CommandChip>
          @{brand.name} {agentName}
        </CommandChip>
      </p>
      <p>
        Disconnect anytime with{" "}
        <CommandChip>
          /{brand.short} unbind {agentName}
        </CommandChip>
        .
      </p>
      <ChannelSwitchCard
        label="Ambient mode"
        checked={ambient}
        onChange={handleAmbientChange}
        disabled={saveAmbient.isPending}
      >
        The agent reads along in the channel and may chime in without being
        mentioned when it can clearly help.
      </ChannelSwitchCard>
      {agent && !isSlackDirectMessageId(slackChannelId) && (
        <WhisperCard agent={agent} />
      )}
    </BindSuccessPage>
  );
}
