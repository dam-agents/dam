import { useState } from "react";

import { getBrand } from "../../../brand.js";
import {
  useSetSlackAmbient,
  useSetSlackWhisper,
} from "../../agents/api/mutations.js";
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
  const saveWhisper = useSetSlackWhisper();
  const [whisper, setWhisper] = useState(true);

  const handleAmbientChange = (next: boolean) => {
    const previous = ambient;
    setAmbient(next);
    saveAmbient.mutate(
      { id: agentId, slackChannelId, ...(next ? { ambient: true } : {}) },
      { onError: () => setAmbient(previous) },
    );
  };

  const handleWhisperChange = (next: boolean) => {
    const previous = whisper;
    setWhisper(next);
    saveWhisper.mutate(
      {
        id: agentId,
        slackChannelId,
        whisper: next,
        ...(ambient ? { ambient: true } : {}),
      },
      { onError: () => setWhisper(previous) },
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
        disabled={saveAmbient.isPending || saveWhisper.isPending}
      >
        The agent reads along in the channel and may chime in without being
        mentioned when it can clearly help.
      </ChannelSwitchCard>
      {!isSlackDirectMessageId(slackChannelId) && (
        <WhisperCard
          checked={whisper}
          onChange={handleWhisperChange}
          disabled={saveAmbient.isPending || saveWhisper.isPending}
        />
      )}
    </BindSuccessPage>
  );
}
