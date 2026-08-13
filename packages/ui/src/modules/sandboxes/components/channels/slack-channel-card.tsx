import { Add, OverflowMenuHorizontal } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useStore } from "../../../../store.js";
import type { AgentView } from "../../../../types.js";
import { useDisconnectSlack } from "../../../agents/api/mutations.js";
import type { SlackChannel } from "../../hooks/use-slack-channel-form.js";
import { findSlackChannels } from "../../hooks/use-slack-channel-form.js";
import { ChannelCard } from "./channel-card.js";
import { SlackChannelModal } from "./slack-channel-modal.js";

/** Which binding the modal is editing: a channel, or `"new"` for a connect. */
type ModalTarget = SlackChannel | "new" | null;

export function SlackChannelCard({ agent }: { agent: AgentView | undefined }) {
  const slackChannels = findSlackChannels(agent);
  const [modalTarget, setModalTarget] = useState<ModalTarget>(null);

  return (
    <ChannelCard iconSlug="slack" title="Slack">
      <div className="flex flex-col items-start gap-3 px-4 py-4">
        {agent && slackChannels.length > 0 ? (
          <div className="flex w-full flex-col gap-2">
            {slackChannels.map((channel) => (
              <SlackChannelRow
                key={channel.slackChannelId}
                agentId={agent.id}
                channel={channel}
                onEdit={() => setModalTarget(channel)}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No channels connected yet. Mentions of the bot in a connected
            channel drive this sandbox.
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setModalTarget("new")}
          disabled={!agent}
          data-testid="slack-connect"
        >
          <Add size={16} />
          Connect channel
        </Button>
      </div>
      {modalTarget && agent && (
        <SlackChannelModal
          agent={agent}
          channel={modalTarget === "new" ? undefined : modalTarget}
          onClose={() => setModalTarget(null)}
        />
      )}
    </ChannelCard>
  );
}

function SlackChannelRow({
  agentId,
  channel,
  onEdit,
}: {
  agentId: string;
  channel: SlackChannel;
  onEdit: () => void;
}) {
  const showConfirm = useStore((s) => s.showConfirm);
  const disconnectSlack = useDisconnectSlack();

  const handleDisconnect = async () => {
    if (
      await showConfirm(
        `Mentions in ${channel.slackChannelId} will stop reaching this sandbox.`,
        "Disconnect Slack channel?",
        { kind: "destructive", confirmLabel: "Disconnect" },
      )
    )
      disconnectSlack.mutate({
        id: agentId,
        slackChannelId: channel.slackChannelId,
      });
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] text-foreground">
          {channel.slackChannelId}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {channel.ambient ? "Ambient on" : "Ambient off"}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Slack channel ${channel.slackChannelId} actions`}
            data-testid="slack-channel-menu"
          >
            <OverflowMenuHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
          <DropdownMenuItem
            tone="danger"
            disabled={disconnectSlack.isPending}
            onSelect={() => void handleDisconnect()}
          >
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
