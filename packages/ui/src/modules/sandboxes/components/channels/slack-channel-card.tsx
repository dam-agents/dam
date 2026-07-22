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
import { findSlackChannel } from "../../hooks/use-slack-channel-form.js";
import { ChannelCard } from "./channel-card.js";
import { SlackChannelModal } from "./slack-channel-modal.js";

export function SlackChannelCard({ agent }: { agent: AgentView | undefined }) {
  const slackChannel = findSlackChannel(agent);
  const showConfirm = useStore((s) => s.showConfirm);
  const disconnectSlack = useDisconnectSlack();
  const [modalOpen, setModalOpen] = useState(false);

  const handleDisconnect = async () => {
    if (!agent) return;
    if (
      await showConfirm(
        "Mentions in the channel will stop reaching this sandbox.",
        "Disconnect Slack channel?",
        { kind: "destructive", confirmLabel: "Disconnect" },
      )
    )
      disconnectSlack.mutate({ id: agent.id });
  };

  return (
    <ChannelCard iconSlug="slack" title="Slack">
      {agent && slackChannel ? (
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] text-foreground">
              {slackChannel.slackChannelId}
            </p>
            <p className="truncate text-[14px] text-muted-foreground">
              {bindingSubtitle(slackChannel, agent.allowedUserEmails)}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Slack channel actions"
                data-testid="slack-channel-menu"
              >
                <OverflowMenuHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setModalOpen(true)}>
                Edit
              </DropdownMenuItem>
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
      ) : (
        <div className="flex flex-col items-start gap-3 px-4 py-4">
          <p className="text-[14px] text-muted-foreground">
            No channel connected yet. Mentions of the bot in the connected
            channel drive this sandbox.
          </p>
          <Button
            variant="outline"
            className="h-[32px] px-3 text-[14px] font-normal"
            onClick={() => setModalOpen(true)}
            disabled={!agent}
            data-testid="slack-connect"
          >
            <Add size={16} />
            Connect channel
          </Button>
        </div>
      )}
      {modalOpen && agent && (
        <SlackChannelModal agent={agent} onClose={() => setModalOpen(false)} />
      )}
    </ChannelCard>
  );
}

function bindingSubtitle(
  channel: NonNullable<ReturnType<typeof findSlackChannel>>,
  allowedUserEmails: string[],
): string {
  if (channel.mode === "shared")
    return channel.ambient ? "Shared · ambient" : "Shared";
  return allowedUserEmails.length > 0
    ? `Person-scoped · ${allowedUserEmails.length} allowed user${allowedUserEmails.length === 1 ? "" : "s"}`
    : "Person-scoped · unrestricted";
}
