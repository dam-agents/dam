import { useState } from "react";

import { getBrand } from "../../../brand.js";
import { useConnectSlack } from "../../agents/api/mutations.js";
import { BindSuccessPage } from "../../agents/components/bind/bind-success-page.js";
import { CommandChip } from "../../agents/components/bind/command-chip.js";
import { AmbientModeCard } from "../../sandboxes/components/channels/ambient-mode-card.js";

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
  const connectSlack = useConnectSlack();
  const [ambient, setAmbient] = useState(false);

  const handleAmbientChange = (next: boolean) => {
    setAmbient(next);
    connectSlack.mutate(
      { id: agentId, slackChannelId, ...(next ? { ambient: true } : {}) },
      { onError: () => setAmbient(!next) },
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
      <AmbientModeCard checked={ambient} onChange={handleAmbientChange}>
        The agent reads along in the channel and may chime in without being
        mentioned when it can clearly help.
      </AmbientModeCard>
    </BindSuccessPage>
  );
}
